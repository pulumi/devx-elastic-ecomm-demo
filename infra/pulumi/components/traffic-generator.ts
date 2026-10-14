import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";
import { ecrImage } from "./shop";

export interface TrafficGeneratorArgs {
  targetUrl: pulumi.Input<string>;
  vpc: awsx.ec2.Vpc;
  cluster: aws.ecs.Cluster;
  esUrl: pulumi.Input<string>;
  esApiKey: pulumi.Input<string>;
  anthropicApiKey?: pulumi.Input<string>;
  /** EventBridge Scheduler expression, e.g. "rate(10 minutes)". */
  schedule: string;
  enabled: boolean;
  humans: number;
  agents: number;
  llmRuns: number;
}

// apps/traffic-gen as a Fargate task that EventBridge Scheduler starts on a
// fixed rate. Each run is one "wave" of shoppers and then exits, so it
// costs nothing between waves.
export class TrafficGenerator extends pulumi.ComponentResource {
  public readonly taskDefinitionArn: pulumi.Output<string>;
  public readonly runTaskCommand: pulumi.Output<string>;

  constructor(name: string, args: TrafficGeneratorArgs, opts?: pulumi.ComponentResourceOptions) {
    super("shopfront:aws:TrafficGenerator", name, {}, opts);
    const parent = this;

    const { image } = ecrImage(`${name}`, "apps/traffic-gen/Dockerfile", parent);

    const secretValues: [string, pulumi.Input<string>][] = [["ELASTICSEARCH_API_KEY", args.esApiKey]];
    if (args.anthropicApiKey) secretValues.push(["ANTHROPIC_API_KEY", args.anthropicApiKey]);
    const secrets = secretValues.map(([envName, value]) => {
      const s = new aws.secretsmanager.Secret(`${name}-${envName.toLowerCase().replace(/_/g, "-")}`, { recoveryWindowInDays: 0 }, { parent });
      new aws.secretsmanager.SecretVersion(`${name}-${envName.toLowerCase().replace(/_/g, "-")}`, { secretId: s.id, secretString: value }, { parent });
      return { name: envName, valueFrom: s.arn };
    });

    const executionRole = new aws.iam.Role(`${name}-exec`, { assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "ecs-tasks.amazonaws.com" }) }, { parent });
    new aws.iam.RolePolicyAttachment(`${name}-exec-managed`, { role: executionRole.name, policyArn: aws.iam.ManagedPolicy.AmazonECSTaskExecutionRolePolicy }, { parent });
    new aws.iam.RolePolicy(
      `${name}-exec-secrets`,
      {
        role: executionRole.id,
        policy: pulumi.jsonStringify({
          Version: "2012-10-17",
          Statement: [{ Effect: "Allow", Action: ["secretsmanager:GetSecretValue"], Resource: secrets.map((s) => s.valueFrom) }],
        }),
      },
      { parent },
    );

    const logGroup = new aws.cloudwatch.LogGroup(`${name}-logs`, { retentionInDays: 7 }, { parent });

    const task = new awsx.ecs.FargateTaskDefinition(
      `${name}-task`,
      {
        executionRole: { roleArn: executionRole.arn },
        cpu: "1024",
        memory: "2048",
        container: {
          name: "traffic-gen",
          image: image.ref,
          essential: true,
          environment: [
            { name: "TARGET_URL", value: args.targetUrl },
            { name: "ELASTICSEARCH_URL", value: args.esUrl },
            { name: "HUMAN_SESSIONS", value: String(args.humans) },
            { name: "AGENT_SESSIONS", value: String(args.agents) },
            { name: "LLM_AGENT_RUNS", value: String(args.llmRuns) },
            { name: "SPREAD_SECONDS", value: "240" },
          ],
          secrets,
          logConfiguration: {
            logDriver: "awslogs",
            options: { "awslogs-group": logGroup.name, "awslogs-region": aws.getRegionOutput({}, { parent }).region, "awslogs-stream-prefix": "wave" },
          },
        },
      },
      { parent },
    );

    const sg = new aws.ec2.SecurityGroup(
      `${name}-sg`,
      { vpcId: args.vpc.vpcId, description: "Traffic generator: outbound only", egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }] },
      { parent },
    );

    const schedulerRole = new aws.iam.Role(`${name}-scheduler`, { assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "scheduler.amazonaws.com" }) }, { parent });
    new aws.iam.RolePolicy(
      `${name}-scheduler-run-task`,
      {
        role: schedulerRole.id,
        policy: pulumi.jsonStringify({
          Version: "2012-10-17",
          Statement: [
            { Effect: "Allow", Action: ["ecs:RunTask"], Resource: [task.taskDefinition.arnWithoutRevision.apply((a) => `${a}:*`)] },
            { Effect: "Allow", Action: ["iam:PassRole"], Resource: [executionRole.arn, task.taskDefinition.taskRoleArn.apply((a) => a ?? executionRole.arn)] },
          ],
        }),
      },
      { parent },
    );

    new aws.scheduler.Schedule(
      `${name}-schedule`,
      {
        description: "Starts one Shopfront traffic wave",
        scheduleExpression: args.schedule,
        state: args.enabled ? "ENABLED" : "DISABLED",
        flexibleTimeWindow: { mode: "OFF" },
        target: {
          arn: args.cluster.arn,
          roleArn: schedulerRole.arn,
          ecsParameters: {
            taskDefinitionArn: task.taskDefinition.arn,
            launchType: "FARGATE",
            taskCount: 1,
            networkConfiguration: { subnets: args.vpc.publicSubnetIds, securityGroups: [sg.id], assignPublicIp: true },
          },
          retryPolicy: { maximumRetryAttempts: 0 },
        },
      },
      { parent },
    );

    this.taskDefinitionArn = task.taskDefinition.arn;
    this.runTaskCommand = pulumi.interpolate`aws ecs run-task --cluster ${args.cluster.name} --launch-type FARGATE --task-definition ${task.taskDefinition.arn} --network-configuration "awsvpcConfiguration={subnets=[${args.vpc.publicSubnetIds.apply((s) => s.join(","))}],securityGroups=[${sg.id}],assignPublicIp=ENABLED}"`;
    this.registerOutputs({ taskDefinitionArn: this.taskDefinitionArn });
  }
}
