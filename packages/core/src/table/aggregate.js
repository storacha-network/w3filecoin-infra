import { Kysely } from 'kysely'

import { useInclusionTable } from './inclusion.js'
import { getDialect } from './utils.js'
import {
  SQLSTATE_UNIQUE_VALUE_CONSTRAINT
} from './constants.js'
import {
  DatabaseOperationError,
  DatabaseUniqueValueConstraintError
} from './errors.js'

export const TABLE_NAME = 'aggregate'

/**
 * @param {import('../types').DialectProps} dialectOpts
 */
export function createAggregateTable (dialectOpts) {
  const dialect = getDialect(dialectOpts)

  const dbClient = new Kysely({
    dialect
  })

  return useAggregateTable(dbClient)
}

/**
 * 
 * @param {import('kysely').Kysely<import('../sql.generated').Database>} dbClient
 * @returns {import('../types').AggregateTable}
 */
export function useAggregateTable (dbClient) {
  return {
    insert: async (aggregateItem, pieceItems) => {
      const inserted = (new Date()).toISOString()
      const item = {
        link: `${aggregateItem.link}`,
        size: aggregateItem.size,
        inserted
      }

      try {
        // Transaction
        await dbClient.transaction().execute(async trx => {
          // create inclusion tables backed by transaction client
          const inclusionTable = useInclusionTable(trx)

          // Insert Aggregate and its dependencies
          await trx
            .insertInto(TABLE_NAME)
            .values({
              ...item,
              inserted
            })
            .execute()

          // Set inclusion items
          const { error } = await inclusionTable.aggregate(
            pieceItems,
            aggregateItem.link
          )

          if (error) {
            throw error
          }
        })
      } catch (/** @type {any} */ error) {
        return {
          error: Number.parseInt(error.code) === SQLSTATE_UNIQUE_VALUE_CONSTRAINT ?
            new DatabaseUniqueValueConstraintError(error.message) :
            new DatabaseOperationError(error.message)
        }
      }
      return {
        ok: {}
      }
    }
  }
}
