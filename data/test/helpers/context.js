import anyTest from 'ava'

/**
 * @typedef {object} AggregateContext
 * @property {string} dbEndpoint
 * @property {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoClient
 *
 * @typedef {import("ava").TestFn<Awaited<AggregateContext>>} TestFn
 */

// eslint-disable-next-line unicorn/prefer-export-from
export const test  = /** @type {TestFn} */ (anyTest)
