export interface DeployHookConfig {
  webhookSecret: string;
  gitRemote: string;
  sshUser?: string;
  sshHost?: string;
  sshPort?: string;
  healthcheckUrl?: string;
}

// Fails fast at startup rather than accepting requests with a missing
// secret — a deploy webhook with no auth configured is worse than one that
// refuses to start.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): DeployHookConfig {
  const webhookSecret = env.DEPLOY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("DEPLOY_WEBHOOK_SECRET must be set — refusing to start an unauthenticated deploy webhook");
  }
  const gitRemote = env.DEPLOY_GIT_REMOTE;
  if (!gitRemote) {
    throw new Error("DEPLOY_GIT_REMOTE must be set to the repo this webhook is allowed to deploy from");
  }

  return {
    webhookSecret,
    gitRemote,
    sshUser: env.DEPLOY_SSH_USER,
    sshHost: env.DEPLOY_SSH_HOST,
    sshPort: env.DEPLOY_SSH_PORT,
    healthcheckUrl: env.DEPLOY_HEALTHCHECK_URL,
  };
}
