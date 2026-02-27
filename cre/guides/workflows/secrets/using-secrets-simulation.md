# Using Secrets in Simulation
Source: https://docs.chain.link/cre/guides/workflow/secrets/using-secrets-simulation-ts
Last Updated: 2025-11-04


This guide explains how to use secrets during **local development and simulation**. When you're simulating a workflow on your local machine with `cre workflow simulate`, secrets are provided via environment variables or a `.env` file.

> **NOTE: For deployed workflows**
>
> If you're deploying workflows, you'll need to store secrets in the **Vault DON** instead. See [Using Secrets with Deployed Workflows](/cre/guides/workflow/secrets/using-secrets-deployed) for details.

At a high level, the process follows a simple, three-step pattern:

1. **Declare**: You declare the logical names of your secrets in a `secrets.yaml` file.
2. **Provide**: You provide the actual secret values in a `.env` file or as environment variables.
3. **Use**: You access the secrets in your workflow code using the SDK's secret management API.

This separation of concerns ensures that your workflow code is portable and your secrets are never hard-coded.

> **NOTE: Best Practices for Storing Secrets**
>
> While this guide shows secrets being provided via a plaintext `.env` file and environment variables, the recommended
> best practice for security is to use a dedicated secrets manager. See our guide on [Managing Secrets with 1Password
> CLI](/cre/guides/workflow/secrets/managing-secrets-1password) to learn how to inject secrets securely at runtime.

## Step-by-step guide

### Step 1: Declare your secrets (`secrets.yaml`)

The first step is to create a `secrets.yaml` file in the root of your project. This file acts as a manifest, defining the "logical names" or "IDs" for the secrets your workflow will use.

In this file, you map a logical name (which you'll use in your workflow code) to one environment variable name that will hold the actual secret value.

**Example `secrets.yaml`:**

```yaml
# in project-root/secrets.yaml
secretsNames:
  # This is the logical ID you will use in your workflow code
  SECRET_ADDRESS:
    # This is the environment variable the CLI will look for
    - SECRET_ADDRESS_ALL
```

### Step 2: Provide the secret values

Next, you need to provide the actual values for the secrets. The `cre` CLI can read these values in two primary ways.

#### Method 1: Using shell environment variables (Recommended)

You can provide secrets as standard environment variables directly in your shell.

For example, in your terminal:

```bash
export SECRET_ADDRESS_ALL="0x1234567890abcdef1234567890abcdef12345678"
```

When you run the `cre workflow simulate` command in the same terminal session, the CLI will have access to this variable.

#### Method 2: Using a `.env` file

Create a `.env` file in your project's root directory. The `cre` CLI automatically finds this file and loads the variables defined within it into the environment for your simulation. The variable names here must match those you declared in `secrets.yaml`.

**Example `.env` file:**

```bash
# in project-root/.env

# The variable name matches the one in secrets.yaml
SECRET_ADDRESS_ALL="0x1234567890abcdef1234567890abcdef12345678"
```

> **CAUTION: Never Commit Your Secrets**
>
> The project's `.gitignore` file is already configured to ignore `.env` files. **Never** commit this file to version
> control.

### Step 3: Use the secret in your workflow

Now you can access the secret in your workflow code. The SDK provides a method to retrieve secrets using the logical ID you defined in `secrets.yaml`.

The following code shows a complete, runnable workflow that triggers on a schedule, fetches a secret, and logs its value.

**Example workflow:**

Code snippet for Fetching Single Secret (TypeScript):

```typescript
import { CronCapability, handler, Runner, type Runtime } from "@chainlink/cre-sdk"

// Config can be an empty object if you don't need any parameters from config.json
type Config = Record<string, never>

// Define the logical name of the secret as a constant for clarity
const SECRET_NAME = "SECRET_ADDRESS"

// onCronTrigger is the callback function that gets executed when the cron trigger fires
// This is where you use the secret
const onCronTrigger = (runtime: Runtime<Config>): string => {
  // Call runtime.getSecret with the secret's logical ID
  const secret = runtime.getSecret({ id: SECRET_NAME }).result()

  // Use the secret's value
  const secretAddress = secret.value
  runtime.log(`Successfully fetched a secret! Address: ${secretAddress}`)

  // ... now you can use the secretAddress in your logic ...
  return "Success"
}

// initWorkflow is the entry point for the workflow
const initWorkflow = () => {
  const cron = new CronCapability()

  return [handler(cron.trigger({ schedule: "0 */10 * * * *" }), onCronTrigger)]
}

// main is the entry point for the WASM binary
export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}
```

### Step 4: Configure secrets path in `workflow.yaml`

Before simulating, you need to tell the CLI where to find your secrets file. This is configured in your `workflow.yaml` file under `workflow-artifacts.secrets-path`.

Open your `workflow.yaml` file and set the `secrets-path`:

```yaml
local-simulation:
  user-workflow:
    workflow-name: "my-workflow"
    workflow-artifacts:
      workflow-path: "./main.ts"
      config-path: "./config.json"
      secrets-path: "../secrets.yaml" # Path to your secrets file
```

Notice the path `../secrets.yaml`. Because the workflow artifacts are relative to the workflow directory, you need to point to the `secrets.yaml` file located one level up in the project root.

### Step 5: Run the simulation

Now you can simulate your workflow:

```bash
cre workflow simulate my-workflow --target staging-settings
```

The CLI will automatically read the `secrets-path` from your `workflow.yaml` and load the secrets from your `.env` file or environment variables you provided in your terminal session.

## Fetching multiple secrets

You can fetch multiple secrets by calling the secret retrieval method multiple times within your workflow.

> **CAUTION: Fetch secrets sequentially**
>
> The WASM host for the CRE runtime does not support parallel `runtime.getSecret()` requests. Always fetch secrets **sequentially**: call `getSecret()`, get the result with `.result()`, then call `getSecret()` again for the next secret. Do not attempt to fetch multiple secrets in parallel.

The following example builds on the previous one. First, update your `secrets.yaml` to declare two secrets:

```yaml
secretsNames:
  SECRET_ADDRESS:
    - SECRET_ADDRESS_ALL
  API_KEY:
    - API_KEY_ALL
```

Then provide the values in your `.env` file or export them as environment variables in your terminal session:

```bash
export SECRET_ADDRESS_ALL="0x1234567890abcdef1234567890abcdef12345678"
export API_KEY_ALL="your-api-key-here"
```

Now you can fetch both secrets in your workflow code:

Code snippet for Fetching Multiple Secrets (TypeScript):

```typescript
import { CronCapability, handler, Runner, type Runtime } from "@chainlink/cre-sdk"

// Config can be an empty object if you don't need any parameters from config.json
type Config = Record<string, never>

const SECRET_ADDRESS_NAME = "SECRET_ADDRESS"
const API_KEY_NAME = "API_KEY"

const onCronTrigger = (runtime: Runtime<Config>): string => {
  // 1. Request the first secret
  const secretAddress = runtime.getSecret({ id: SECRET_ADDRESS_NAME }).result()

  // 2. Request the second secret
  const apiKey = runtime.getSecret({ id: API_KEY_NAME }).result()

  // 3. Use your secrets
  runtime.log(`Successfully fetched secrets! Address: ${secretAddress.value}, API Key: ${apiKey.value}`)

  return "Success"
}

// initWorkflow is the entry point for the workflow
const initWorkflow = () => {
  const cron = new CronCapability()

  return [handler(cron.trigger({ schedule: "0 */10 * * * *" }), onCronTrigger)]
}

// main is the entry point for the WASM binary
export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}
```