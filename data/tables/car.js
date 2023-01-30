import {
  DynamoDBClient,
  TransactWriteItemsCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'

import { MAX_TRANSACT_WRITE_ITEMS } from './constants.js'

/**
 * Abstraction layer to handle operations on Filecoin pending deal Car Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {import('../types').CarTable}
 */
export function createCarTable (region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint
  })

  return {
    batchWrite: async (cars) => {
      if (cars.length > MAX_TRANSACT_WRITE_ITEMS) {
        throw new Error('TODO error')
      }

      const insertedAt = new Date().toISOString()
      // TODO: Put item Batch...
      const cmd = new TransactWriteItemsCommand({
        TransactItems: cars.map(car => ({
          Put: {
            TableName: tableName,
            Key: marshall({
              link: car.link
            }),
            Item: {
              link: { 'S': car.link },
              size: { 'N': `${car.size}`},
              url: { 'S': car.url },
              commP: { 'S': car.commP },
              md5: { 'S': car.md5 },
              insertedAt: { 'S': insertedAt },
            },
            ConditionExpression: 'attribute_not_exists(link)'
          }
        })),
      })

      await dynamoDb.send(cmd)
    }
  }
}
