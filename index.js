const core = require('@actions/core');
const httpClient = require('@actions/http-client');


async function listRunnersInGroup({ org, runnerGroupId, token }) {
  // Docs: https://docs.github.com/en/rest/actions/self-hosted-runners#list-all-self-hosted-runners-in-a-group-for-an-organization
  const http = new httpClient.HttpClient('http-client');
  const headers = { 'Authorization': `Bearer ${token}` };

  // GET /orgs/{org}/actions/runner-groups/{runner_group_id}/runners
  const url = `https://api.github.com/orgs/${org}/actions/runner-groups/${runnerGroupId}/runners`;
  const response = await http.getJson(url, headers);

  if (response.statusCode !== 200) {
    throw new Error(`Failed to list runners in group. Status code: ${response.statusCode}`);
  }

  const { runners = [] } = response.result;
  return runners;
}

async function getRunnerGroupId({ org, runnerGroupName, token }) {
  // This will list the runner groups in the org.
  // Docs: https://docs.github.com/en/rest/actions/self-hosted-runners#list-self-hosted-runner-groups-for-an-organization
  const http = new httpClient.HttpClient('http-client');
  const headers = { 'Authorization': `Bearer ${token}` };

  // GET /orgs/{org}/actions/runner-groups
  const url = `https://api.github.com/orgs/${org}/actions/runner-groups`;
  const response = await http.getJson(url, headers);

  if (response.statusCode !== 200) {
    throw new Error(`Failed to list runner groups. Status code: ${response.statusCode}`);
  }

  const { runner_groups: runnerGroups = [] } = response.result;
  const group = runnerGroups.find(g => g.name === runnerGroupName);

  if (!group) {
    throw new Error(`Runner group "${runnerGroupName}" not found in org "${org}".`);
  }

  return group.id;
}

async function checkRunner({ token, owner, repo, primaryRunnerLabels, fallbackRunner, runnerGroup }) {
  const http = new httpClient.HttpClient('http-client');
  const headers = {
    'Authorization': `Bearer ${token}`,
  };
  const response = await http.getJson(`https://api.github.com/repos/${owner}/${repo}/actions/runners`, headers);

  if (response.statusCode !== 200) {
    return { error: `Failed to get runners. Status code: ${response.statusCode}` };
  }

  const runners = response.result.runners || [];
  let useRunner = fallbackRunner;
  let primaryIsOnline = false;

  for (const runner of runners) {
    if (runner.status === 'online') {
      const runnerLabels = runner.labels.map(label => label.name);
      if (primaryRunnerLabels.every(label => runnerLabels.includes(label))) {
        primaryIsOnline = true;
        useRunner = primaryRunnerLabels.join(',');
        break;
      }
    }
  }

  core.info(`Runner group: ${runnerGroup}`);
  if (!primaryIsOnline && runnerGroup) {
    const groupId = await getRunnerGroupId({ org: owner, runnerGroupName: runnerGroup, token });
    const foundGroupRunner = await listRunnersInGroup({ org: owner, runnerGroupId: groupId, token });
    if (foundGroupRunner.length > 0) {
      core.info(`Found ${foundGroupRunner.length} runners for ${groupId}`);
      // useRunner = foundGroupRunner.map(runner => runner.name)[0];
    }
  }

  // return a JSON string so that it can be parsed using `fromJson`, e.g. fromJson('["self-hosted", "linux"]')
  return { useRunner: JSON.stringify(useRunner.split(',')), primaryIsOnline };
}

async function main() {
  const githubRepository = process.env.GITHUB_REPOSITORY;
  const [owner, repo] = githubRepository.split("/");

  try {
    const inputs = {
      owner,
      repo,
      token: core.getInput('github-token', { required: true }),
      primaryRunnerLabels: core.getInput('primary-runner', { required: true }).split(','),
      fallbackRunner: core.getInput('fallback-runner', { required: true }),
      runnerGroup: core.getInput('runner-group', { required: false }),
    };

    const { useRunner, primaryIsOnline, error } = await checkRunner(inputs);

    if (error) {
      core.setFailed(error);
      return;
    }

    core.info(`Primary runner is online: ${primaryIsOnline}.`);
    core.info(`Using runner: ${useRunner}.`);

    core.setOutput('use-runner', useRunner);
  } catch (error) {
    core.setFailed(error.message);
  }
}

module.exports = { checkRunner };

if (require.main === module) {
  main();
}
