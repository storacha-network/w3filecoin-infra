import { tesWorkflow as test } from '../helpers/context.js'
import { createS3, createBucket, createQueue } from '../helpers/resources.js'
import { randomCargo } from '../helpers/cargo.js'

import { Consumer } from 'sqs-consumer'
import pWaitFor from 'p-wait-for'
import delay from 'delay'
import { QueueOperationFailed, StoreOperationErrorName, QueueOperationErrorName } from '@web3-storage/filecoin-api/errors'

import { encode as pieceEncode } from '../../src/data/piece.js'
import { encode as bufferEncode, decode as bufferDecode } from '../../src/data/buffer.js'
import { encode as aggregateEncode, decode as aggregateDecode } from '../../src/data/aggregate.js'
import { createBucketStoreClient } from '../../src/store/bucket-client.js'
import { createQueueClient } from '../../src/queue/client.js'

import { reduceBuffer } from '../../src/workflow/buffer-reducing.js'

/**
 * @typedef {import('../../src/data/types.js').PiecePolicy} PiecePolicy
 */

test.beforeEach(async (t) => {
  const sqs = await createQueue()

  /** @type {import('@aws-sdk/client-sqs').Message[]} */
  const queuedMessages = []
  const queueConsumer = Consumer.create({
    queueUrl: sqs.queueUrl,
    sqs: sqs.client,
    handleMessage: (message) => {
      queuedMessages.push(message)
      return Promise.resolve()
    }
  })

  Object.assign(t.context, {
    s3: (await createS3()).client,
    sqsClient: sqs.client,
    queueName: sqs.queueName,
    queueUrl: sqs.queueUrl,
    queueConsumer,
    queuedMessages
  })
})

test.beforeEach(async t => {
  t.context.queueConsumer.start()
  await pWaitFor(() => t.context.queueConsumer.isRunning)
})

test.afterEach(async t => {
  t.context.queueConsumer.stop()
  await delay(1000)
})

test('can reduce received buffers', async t => {
  const { s3, sqsClient, queueUrl, queuedMessages } = t.context

  const bucketName = await createBucket(s3)
  const { buffers, bufferRecords } = await getBuffers(2)

  const storeClient = createBucketStoreClient(s3, {
    name: bucketName,
    encodeRecord: bufferEncode.storeRecord,
    decodeRecord: bufferDecode.storeRecord,
  })
  const bufferQueueClient = createQueueClient(sqsClient, {
    queueUrl,
    encodeMessage: bufferEncode.message,
  })
  const aggregateQueueClient = createQueueClient(sqsClient, {
    queueUrl,
    encodeMessage: aggregateEncode.message,
  })

  // Store both buffers in store
  await Promise.all(
    buffers.map(b => storeClient.put(b))
  )

  const reduceBufferResp = await reduceBuffer({
    storeClient,
    bufferQueueClient,
    aggregateQueueClient,
    bufferRecords
  })

  t.truthy(reduceBufferResp.ok)
  t.falsy(reduceBufferResp.error)
  t.is(reduceBufferResp.ok, buffers.length)

  // Validate message received to queue
  await pWaitFor(() => queuedMessages.length === 1)

  const aggregateRef = await aggregateDecode.message(queuedMessages[0].Body || '')
  const getBufferRes = await storeClient.get(
    `${aggregateRef.buffer}/${aggregateRef.buffer}`
  )
  t.truthy(getBufferRes.ok)
  t.falsy(getBufferRes.error)
})

// TODO: merge and remaining

test('fails reducing received buffers if fails to read them from store', async t => {
  const { s3, sqsClient, queueUrl } = t.context

  const bucketName = await createBucket(s3)
  const { buffers, bufferRecords } = await getBuffers(2)

  const storeClient = createBucketStoreClient(s3, {
    name: bucketName,
    encodeRecord: bufferEncode.storeRecord,
    decodeRecord: bufferDecode.storeRecord,
  })
  const bufferQueueClient = createQueueClient(sqsClient, {
    queueUrl,
    encodeMessage: bufferEncode.message,
  })
  const aggregateQueueClient = createQueueClient(sqsClient, {
    queueUrl,
    encodeMessage: aggregateEncode.message,
  })

  // Store ONLY ONE buffer in store
  await storeClient.put(buffers[0])

  const reduceBufferResp = await reduceBuffer({
    storeClient,
    bufferQueueClient,
    aggregateQueueClient,
    bufferRecords
  })

  t.falsy(reduceBufferResp.ok)
  t.truthy(reduceBufferResp.error)
  t.is(reduceBufferResp.error?.name, StoreOperationErrorName)
})

test('fails reducing received buffers if fails to queue aggregate', async t => {
  const { s3, sqsClient, queueUrl } = t.context

  const bucketName = await createBucket(s3)
  const { buffers, bufferRecords } = await getBuffers(2)

  const storeClient = createBucketStoreClient(s3, {
    name: bucketName,
    encodeRecord: bufferEncode.storeRecord,
    decodeRecord: bufferDecode.storeRecord,
  })
  const bufferQueueClient = createQueueClient(sqsClient, {
    queueUrl,
    encodeMessage: bufferEncode.message,
  })
  const aggregateQueueClient = {
    add: () => {
      return {
        error: new QueueOperationFailed('could not queue buffer')
      }
    }
  }

  // Store both buffers in store
  await Promise.all(
    buffers.map(b => storeClient.put(b))
  )

  const reduceBufferResp = await reduceBuffer({
    storeClient,
    bufferQueueClient,
    // @ts-expect-error adapted queue
    aggregateQueueClient,
    bufferRecords
  })

  t.falsy(reduceBufferResp.ok)
  t.truthy(reduceBufferResp.error)
  t.is(reduceBufferResp.error?.name, QueueOperationErrorName)
})

/**
 * @param {number} length
 */
async function getBuffers (length) {
  const pieceBatches = await Promise.all(
    Array.from({ length }).map(() => getPieces()
  ))

  const buffers = await Promise.all(
    pieceBatches.map(async b => buildBuffer(b.pieces)
  ))

  return {
    buffers,
    bufferRecords: await Promise.all(
      buffers.map(bufferEncode.message)
    )
  }
}

/**
 * @param {{ link: import("@web3-storage/data-segment").PieceLink }[]} pieces
 */
function buildBuffer (pieces) {
  return {
    pieces: pieces.map(p => ({
      piece: p.link,
      policy: /** @type {PiecePolicy} */ (0),
      insertedAt: Date.now()
    })),
    storefront: 'did:web:web3.storage',
    group: 'did:web:free.web3.storage',
  }
}

async function getPieces () {
  const pieces = await randomCargo(100, 128)

  const pieceRecords = await Promise.all(pieces.map(p => encodePiece(p)))
  return {
    pieces,
    pieceRecords
  }
}

/**
 * @param {{ link: import("@web3-storage/data-segment").PieceLink }} piece
 */
async function encodePiece (piece) {
  const storefront = 'did:web:web3.storage'
  const group = 'did:web:free.web3.storage'
  const pieceRow = {
    piece: piece.link,
    storefront,
    group,
    insertedAt: Date.now()
  }

  return pieceEncode.message(pieceRow)
}
