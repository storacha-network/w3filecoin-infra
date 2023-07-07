import { parse as parseLink } from 'multiformats/link'
import { sql } from 'kysely'

import { connect } from '../database/index.js'
import {
  SQLSTATE_FOREIGN_KEY_CONSTRAINT_ERROR_CODE,
  DEFAULT_LIMIT
} from '../database/constants.js'
import {
  DatabaseOperationError,
  DatabaseForeignKeyConstraintError
} from '../database/errors.js'

export const TABLE_NAME = 'piece'
export const INCLUSION_TABLE_NAME = 'inclusion'
export const VIEW_NAME = 'cargo'

/**
 * 
 * @param {import('../types.js').DatabaseConnect} conf
 * @returns {import('../types.js').PieceQueue}
 */
export function createPieceQueue (conf) {
  const dbClient = connect(conf)

  return {
    put: async (pieceItems) => {
      const items = pieceItems.map(pieceItem => ({
        link: `${pieceItem.link}`,
        size: pieceItem.size,
        content: `${pieceItem.content}`,
        priority: pieceItem.priority || 0
      }))

      try {
        // Transaction
        await dbClient.transaction().execute(async trx => {
          // Insert to piece table
          await trx
            .insertInto(TABLE_NAME)
            .values(items.map(item => ({
              link: item.link,
              size: item.size,
              content: item.content
            })))
            // NOOP if item is already in table
            .onConflict(oc => oc
              .column('link')
              .doNothing()
            )
            .execute()

          // Insert to inclusion table all pieces
          await trx
            .insertInto(INCLUSION_TABLE_NAME)
            .values(items.map(item => ({
              piece: item.link,
              priority: item.priority,
              aggregate: null
            })))
            // NOOP if item is already in table
            .onConflict(oc => oc
              .expression(sql`piece, COALESCE(aggregate, '0')`)
              .doNothing()
            )
            .execute()
        })
      } catch (/** @type {any} */ error) {
        return {
          error: Number.parseInt(error.code) === SQLSTATE_FOREIGN_KEY_CONSTRAINT_ERROR_CODE ?
            new DatabaseForeignKeyConstraintError(error.message) :
            new DatabaseOperationError(error.message)
        }
      }

      return {
        ok: {}
      }
    },
    peek: async (options = {}) => {
      const limit = options.limit || DEFAULT_LIMIT

      let queuePeakResponse
      try {
        queuePeakResponse = await dbClient
          .selectFrom(VIEW_NAME)
          .selectAll()
          .limit(limit)
          .execute()
      } catch (/** @type {any} */ error) {
        return {
          error: new DatabaseOperationError(error.message)
        }
      }

      /** @type {import('../types.js').Inserted<import('../types').Inclusion>[]} */
      const cargo = queuePeakResponse.map(piece => ({
        // @ts-expect-error sql created types for view get optional
        piece: parseLink(/** @type {string} */ piece.piece),
        priority: /** @type {number} */(piece.priority),
        inserted: /** @type {Date} */(piece.inserted).toISOString(),
        aggregate: piece.aggregate && parseLink(/** @type {string} */ piece.aggregate),
      }))

      return {
        ok: cargo
      }
    }
  }
}
