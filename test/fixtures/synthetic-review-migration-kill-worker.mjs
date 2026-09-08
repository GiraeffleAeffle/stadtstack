import { readFileSync } from 'node:fs';
import { createStagingCaseControlDeploymentProof } from '../../src/staging-case-control-preflight.ts';
import { createCaseDurableDeploymentClaimToken } from '../../src/case-durable-deployment-claim.ts';
import { createStagingSyntheticReviewMigrationAuthorization } from '../../src/staging-synthetic-review-migration-authority.ts';
import { activateSyntheticDepartmentReviewMigration } from '../../src/adapters/sqlite-atomic-topic-case-admission.ts';
const input = JSON.parse(readFileSync(0, 'utf8'));
input.observation.filesystemType = BigInt(input.observation.filesystemType);
input.observation.availableBytes = BigInt(input.observation.availableBytes);
const proof = createStagingCaseControlDeploymentProof({ reviewedBinding: input.binding,
  expectedBindingChecksum: input.binding.bindingChecksum, storageObserver: { observe: () => input.observation } });
input.preparation.sourceConfig.syntheticAdoption.now = () => new Date();
input.preparation.sourceConfig.syntheticAdoption.acceptance = { resolve: async () => null };
activateSyntheticDepartmentReviewMigration({ preparation: input.preparation, targetRootDir: input.binding.storage.rootDir,
  targetDeploymentClaimToken: createCaseDurableDeploymentClaimToken(proof),
  authorization: createStagingSyntheticReviewMigrationAuthorization({ reviewedMigrationSource: { read: () => input.plan },
    migrationPinSource: { read: () => input.plan.planChecksum }, clock: { now: () => input.plan.notBeforeUtc } }),
  failpoint: (point) => { if (point === 'database') process.kill(process.pid, 'SIGKILL'); } });
