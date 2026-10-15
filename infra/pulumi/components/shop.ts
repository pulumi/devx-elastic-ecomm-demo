import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as dockerbuild from "@pulumi/docker-build";
import * as pulumi from "@pulumi/pulumi";
import * as path from "node:path";

export const repoRoot = path.resolve(__dirname, "../../..");

export interface ShopArgs {
  esUrl: pulumi.Input<string>;
  esApiKey: pulumi.Input<string>;
  internalApiKey: pulumi.Input<string>;
  apmServerUrl?: pulumi.Input<string>;
}

// Builds and pushes an image from the monorepo root to its own ECR repo.
export function ecrImage(name: string, dockerfile: string, parent: pulumi.Resource, buildArgs?: Record<string, pulumi.Input<string>>) {
  const repo = new aws.ecr.Repository(name, { forceDelete: true, imageScanningConfiguration: { scanOnPush: true } }, { parent });
  const auth = aws.ecr.getAuthorizationTokenOutput({ registryId: repo.registryId }, { parent });
  const image = new dockerbuild.Image(
    `${name}-image`,
    {
      context: { location: repoRoot },
      dockerfile: { location: path.join(repoRoot, dockerfile) },
      platforms: ["linux/amd64"],
      buildArgs,
      push: true,
      tags: [pulumi.interpolate`${repo.repositoryUrl}:latest`],
      registries: [{ address: repo.repositoryUrl, username: auth.userName, password: auth.password }],
    },
    { parent },
  );
  return { repo, image };
}

// The storefront on ECS Fargate behind an ALB. web (nginx) and api share
// one task: nginx proxies /api and /internal to 127.0.0.1:8787 and mirrors
// page fetches to the API's tracker. SQLite lives on EFS, and the service
// runs exactly one task because SQLite has a single writer.
export class Shop extends pulumi.ComponentResource {
  public readonly url: pulumi.Output<string>;
  public readonly vpc: awsx.ec2.Vpc;
  public readonly cluster: aws.ecs.Cluster;
  public readonly logGroupName: pulumi.Output<string>;
  public readonly serviceName: pulumi.Output<string>;

  constructor(name: string, args: ShopArgs, opts?: pulumi.ComponentResourceOptions) {
    super("shopfront:aws:Shop", name, {}, opts);
    const parent = this;

    // Public subnets only: no NAT gateway to pay for. Tasks get public IPs
    // but only accept traffic from the ALB. DNS hostnames must be on or the
    // tasks can't resolve the EFS mount DNS name.
    this.vpc = new awsx.ec2.Vpc(
      `${name}-vpc`,
      {
        numberOfAvailabilityZones: 2,
        natGateways: { strategy: "None" },
        subnetStrategy: "Auto",
        subnetSpecs: [{ type: "Public" }],
        enableDnsHostnames: true,
        enableDnsSupport: true,
      },
      { parent },
    );

    const albSg = new aws.ec2.SecurityGroup(
      `${name}-alb-sg`,
      {
        vpcId: this.vpc.vpcId,
        description: "Public HTTP to the shop",
        ingress: [{ protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] }],
        egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
      },
      { parent },
    );
    const taskSg = new aws.ec2.SecurityGroup(
      `${name}-task-sg`,
      {
        vpcId: this.vpc.vpcId,
        description: "Shop task: HTTP from the ALB only",
        ingress: [{ protocol: "tcp", fromPort: 80, toPort: 80, securityGroups: [albSg.id] }],
        egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
      },
      { parent },
    );

    const fs = new aws.efs.FileSystem(`${name}-data`, { encrypted: true, tags: { Name: `${name}-sqlite` } }, { parent });
    const efsSg = new aws.ec2.SecurityGroup(
      `${name}-efs-sg`,
      { vpcId: this.vpc.vpcId, description: "NFS from the shop task", ingress: [{ protocol: "tcp", fromPort: 2049, toPort: 2049, securityGroups: [taskSg.id] }] },
      { parent },
    );
    const mountTargets = this.vpc.publicSubnetIds.apply((ids) =>
      ids.map((subnetId, i) => new aws.efs.MountTarget(`${name}-mount-${i}`, { fileSystemId: fs.id, subnetId, securityGroups: [efsSg.id] }, { parent })),
    );
    const accessPoint = new aws.efs.AccessPoint(
      `${name}-ap`,
      {
        fileSystemId: fs.id,
        posixUser: { uid: 1000, gid: 1000 },
        rootDirectory: { path: "/shopfront", creationInfo: { ownerUid: 1000, ownerGid: 1000, permissions: "0755" } },
      },
      { parent },
    );

    const alb = new awsx.lb.ApplicationLoadBalancer(
      `${name}-alb`,
      {
        subnetIds: this.vpc.publicSubnetIds,
        securityGroups: [albSg.id],
        defaultTargetGroup: {
          port: 80,
          protocol: "HTTP",
          targetType: "ip",
          deregistrationDelay: 10,
          healthCheck: { path: "/api/health", interval: 15, healthyThreshold: 2, unhealthyThreshold: 3 },
        },
      },
      { parent },
    );

    const api = ecrImage(`${name}-api`, "apps/api/Dockerfile", parent);
    const web = ecrImage(
      `${name}-web`,
      "apps/web/Dockerfile",
      parent,
      args.apmServerUrl ? { VITE_ELASTIC_APM_SERVER_URL: args.apmServerUrl } : undefined,
    );

    const secret = (id: string, value: pulumi.Input<string>) => {
      const s = new aws.secretsmanager.Secret(`${name}-${id}`, { recoveryWindowInDays: 0 }, { parent });
      new aws.secretsmanager.SecretVersion(`${name}-${id}`, { secretId: s.id, secretString: value }, { parent });
      return s;
    };
    const esKeySecret = secret("es-api-key", args.esApiKey);
    const internalKeySecret = secret("internal-api-key", args.internalApiKey);

    const executionRole = new aws.iam.Role(`${name}-exec`, { assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "ecs-tasks.amazonaws.com" }) }, { parent });
    new aws.iam.RolePolicyAttachment(`${name}-exec-managed`, { role: executionRole.name, policyArn: aws.iam.ManagedPolicy.AmazonECSTaskExecutionRolePolicy }, { parent });
    new aws.iam.RolePolicy(
      `${name}-exec-secrets`,
      {
        role: executionRole.id,
        policy: pulumi.jsonStringify({
          Version: "2012-10-17",
          Statement: [{ Effect: "Allow", Action: ["secretsmanager:GetSecretValue"], Resource: [esKeySecret.arn, internalKeySecret.arn] }],
        }),
      },
      { parent },
    );

    const logGroup = new aws.cloudwatch.LogGroup(`${name}-logs`, { retentionInDays: 7 }, { parent });
    const logs = (prefix: string) => ({
      logDriver: "awslogs",
      options: { "awslogs-group": logGroup.name, "awslogs-region": aws.getRegionOutput({}, { parent }).region, "awslogs-stream-prefix": prefix },
    });

    this.cluster = new aws.ecs.Cluster(`${name}-cluster`, {}, { parent });

    const service = new awsx.ecs.FargateService(
      `${name}-service`,
      {
        cluster: this.cluster.arn,
        desiredCount: 1,
        // Single SQLite writer: stop the old task before starting the new one.
        deploymentMinimumHealthyPercent: 0,
        deploymentMaximumPercent: 100,
        healthCheckGracePeriodSeconds: 30,
        networkConfiguration: { subnets: this.vpc.publicSubnetIds, securityGroups: [taskSg.id], assignPublicIp: true },
        taskDefinitionArgs: {
          executionRole: { roleArn: executionRole.arn },
          cpu: "512",
          memory: "1024",
          volumes: [{ name: "data", efsVolumeConfiguration: { fileSystemId: fs.id, transitEncryption: "ENABLED", authorizationConfig: { accessPointId: accessPoint.id, iam: "DISABLED" } } }],
          containers: {
            api: {
              name: "api",
              image: api.image.ref,
              essential: true,
              portMappings: [{ containerPort: 8787 }],
              environment: [
                { name: "PORT", value: "8787" },
                { name: "SQLITE_JOURNAL_MODE", value: "DELETE" },
                { name: "ELASTICSEARCH_URL", value: args.esUrl },
                ...(args.apmServerUrl ? [{ name: "ELASTIC_APM_SERVER_URL", value: args.apmServerUrl }] : []),
              ],
              secrets: [
                { name: "ELASTICSEARCH_API_KEY", valueFrom: esKeySecret.arn },
                { name: "INTERNAL_API_KEY", valueFrom: internalKeySecret.arn },
              ],
              mountPoints: [{ sourceVolume: "data", containerPath: "/data" }],
              healthCheck: {
                command: ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""],
                interval: 10,
                retries: 3,
                startPeriod: 15,
                timeout: 5,
              },
              logConfiguration: logs("api"),
            },
            web: {
              name: "web",
              image: web.image.ref,
              essential: true,
              portMappings: [{ containerPort: 80, targetGroup: alb.defaultTargetGroup }],
              environment: [{ name: "API_UPSTREAM", value: "127.0.0.1:8787" }],
              dependsOn: [{ containerName: "api", condition: "HEALTHY" }],
              logConfiguration: logs("web"),
            },
          },
        },
      },
      { parent, dependsOn: mountTargets },
    );

    this.url = pulumi.interpolate`http://${alb.loadBalancer.dnsName}`;
    this.logGroupName = logGroup.name;
    this.serviceName = service.service.name;
    this.registerOutputs({ url: this.url });
  }
}
