import * as iam from 'aws-cdk-lib/aws-iam'
import { Duration } from 'aws-cdk-lib'
import { createRequire } from 'module'
import git from 'git-rev-sync'

export const AGGREGATE_KEY = 'w3filecoin-aggregate-id'
const DEFAULT_AGGREGATE_MAX_SIZE = 127*(1<<28)
const DEFAULT_AGGREGATE_MIN_SIZE = 1+127*(1<<27)

/**
 * Return the custom domain config for http api
 * 
 * @param {string} stage
 * @param {string | undefined} hostedZone
 * @returns {{domainName: string, hostedZone: string} | undefined}
 */
export function getCustomDomain (stage, hostedZone) {
  // return no custom domain config if hostedZone not set
  if (!hostedZone) {
    return 
  }
  /** @type Record<string,string> */
  const domainMap = { prod: hostedZone }
  const domainName = domainMap[stage] ?? `${stage}.${hostedZone}`
  return { domainName, hostedZone }
}

export function getApiPackageJson () {
  // @ts-expect-error ts thinks this is unused becuase of the ignore
  const require = createRequire(import.meta.url)
  // @ts-ignore ts dont see *.json and dont like it
  const pkg = require('../../api/package.json')
  return pkg
}

export function getGitInfo () {
  return {
    commmit: git.long('.'),
    branch: git.branch('.')
  }
}

/**
 * @param {import('@serverless-stack/resources').App} app
 * @param {import('@serverless-stack/resources').Stack} stack
 */
export function setupSentry (app, stack) {
  // Skip when locally
  if (app.local) {
    return
  }

  const { SENTRY_DSN } = getEnv()

  stack.addDefaultFunctionEnv({
    SENTRY_DSN,
  })
}

/**
 * @param {import('@serverless-stack/resources').Stack} stack
 */
export function getRedisLambdaRole (stack) {
  // Create role with required policies for lambda to interact with redis cluster
  const role = new iam.Role(stack, `${stack.stackName}-redis-lambda-role`, {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    managedPolicies: [
      // Basic Lambda policy
      {
        managedPolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
      },
      // Basic VPC Access execution role
      {
        managedPolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole',
      }
    ]
  })

  return role
}

/**
 * @param {import('@serverless-stack/resources').Stack} stack
 */
export function getAggregateConfig (stack) {
  if (stack.stage !== 'production') {
    const { AGGREGATE_MAX_SIZE, AGGREGATE_MIN_SIZE } = process.env
    return {
      aggregateMaxSize: AGGREGATE_MAX_SIZE || `${DEFAULT_AGGREGATE_MAX_SIZE}`,
      aggregateMinSize: AGGREGATE_MIN_SIZE || `${20_000}`,
      maxBatchingWindow: Duration.seconds(15)
    }
  }

  return {
    aggregateMaxSize: `${DEFAULT_AGGREGATE_MAX_SIZE}`,
    aggregateMinSize: `${DEFAULT_AGGREGATE_MIN_SIZE}`,
    maxBatchingWindow: Duration.minutes(5)
  }
}

/**
 * Get Env validating it is set.
 */
function getEnv() {
  return {
    AGGREGATE_MAX_SIZE: process.env.AGGREGATE_MAX_SIZE,
    AGGREGATE_MIN_SIZE: process.env.AGGREGATE_MIN_SIZE,
    SENTRY_DSN: mustGetEnv('SENTRY_DSN'),
  }
}

/**
 * 
 * @param {string} name 
 * @returns {string}
 */
function mustGetEnv (name) {
  if (!process.env[name]) {
    throw new Error(`Missing env var: ${name}`)
  }

  // @ts-expect-error there will always be a string there, but typescript does not believe
  return process.env[name]
}
