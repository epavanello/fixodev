import { JobType, AppMentionOnIssueJob, AppMentionOnPullRequestJob } from "../types/jobs";
import { logger } from "../config/logger";
import { cloneRepository } from "../git/clone";
import { get and updatePullRequest } from "../github/pr";
import { processCodeModificationRequest } from "../llm/processor";
import { createSourceModifierAgent } from "../llm/processor";
import { taskCompletionTool } from "../llm/tools/task";
import { addCommentToPullRequest } from "../github/pr";
import { checkoutRemoteBranch } from "../git/operations";

export async function handleAppMentionOnPullRequestJob(job: AppMentionOnPullRequestJob) {
  logger.info({ job }, "Handling AppMentionOnPullRequestJob");

  const { originalRepoOwner, originalRepoName, installationId, commandToProcess, repositoryUrl, eventPullRequestNumber, headRef, headSha, commentId } = job;

  const repoPath = `./repos/${originalRepoOwner}/${originalRepoName}`;

  try {
    // 1. Clone the repository
    logger.info({ repoPath, repositoryUrl }, "Cloning repository");
    await cloneRepository(repositoryUrl, repoPath);

    // 2. Checkout the head ref of the PR
    logger.info({ repoPath, headRef, headSha }, "Checking out PR head ref");
    await checkoutRemoteBranch(repoPath, headRef, headSha);

    // 3. Process the command with the LLM agent
    logger.info({ commandToProcess }, "Processing command with LLM agent");

    const agent = await createSourceModifierAgent(
      {
        command: commandToProcess,
        botConfig: { runtime: "node" }, // Assuming node runtime for now
        conversationalLogging: false,
      },
      repoPath,
      taskCompletionTool,
    );

    const result = await agent.run(commandToProcess);

    if (result?.objectiveAchieved) {
      logger.info({ result }, "Agent successfully completed the task");
      // 4. Update the ongoing PR (this part needs more specific implementation based on how you want to update the PR)
      // For now, let's assume we just add a comment to the PR indicating success.
      await addCommentToPullRequest(
        originalRepoOwner,
        originalRepoName,
        eventPullRequestNumber,
        commentId,
        "Successfully applied changes based on your comment!",
        installationId,
      );
    } else {
      logger.warn({ result }, "Agent did not achieve the objective");
      await addCommentToPullRequest(
        originalRepoOwner,
        originalRepoName,
        eventPullRequestNumber,
        commentId,
        "I was unable to complete the requested changes. Please check the logs for more details.",
        installationId,
      );
    }
  } catch (error) {
    logger.error({ error }, "Error handling AppMentionOnPullRequestJob");
    await addCommentToPullRequest(
      originalRepoOwner,
      originalRepoName,
      eventPullRequestNumber,
      commentId,
      `An error occurred while processing your request: ${error instanceof Error ? error.message : String(error)}`,
      installationId,
    );
  }
}
