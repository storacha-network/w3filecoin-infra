import { testQueue as test } from '../helpers/context.js'

import { createContentQueue } from '../../src/queue/content.js'
import { ContentEncodeErrorName } from '../../src/queue/errors.js'

import { createDatabase } from '../helpers/resources.js'
import { getCargo } from '../helpers/cargo.js'

test.beforeEach(async (t) => {
  Object.assign(t.context, {
    dbClient: (await createDatabase()).client,
  })
})

test('can insert to content queue and peek queued content', async t => {
  const { dbClient } = t.context
  const contentQueue = createContentQueue(dbClient)
  const cargoItems = await getCargo(10)

  // Put content
  const queuePutResp = await Promise.all(
    cargoItems.map(item => contentQueue.put(item.content))
  )
  t.falsy(queuePutResp.find(resp => resp.error))

  // Peek content
  const queuePeekResp = await contentQueue.peek()
  if (!queuePeekResp.ok) {
    throw new Error('no queued items after insert')
  }

  t.is(queuePeekResp.ok.length, cargoItems.length)
  for(const item of queuePeekResp.ok) {
    const cargoItem = cargoItems.find(ca => ca.content.link.equals(item.link))
    if (!cargoItem) {
      throw new Error('inserted cargo item should be queued')
    }
    t.truthy(cargoItem)
    t.is(item.size, cargoItem.content.size)
    t.deepEqual(item.source, cargoItem.content.source)
    t.truthy(item.inserted)
  }
})

test('can insert same batch to the content queue and only peek once', async t => {
  const { dbClient } = t.context
  const contentQueue = createContentQueue(dbClient)
  const cargoItems = await getCargo(10)

  // Put content
  const queuePutResp0 = await Promise.all(
    cargoItems.map(item => contentQueue.put(item.content))
  )
  t.falsy(queuePutResp0.find(resp => resp.error))

  // Put same content
  const queuePutResp1 = await Promise.all(
    cargoItems.map(item => contentQueue.put(item.content))
  )
  t.falsy(queuePutResp1.find(resp => resp.error))

  // Peek content
  const queuePeekResp = await contentQueue.peek()
  if (!queuePeekResp.ok) {
    throw new Error('no queued items after insert')
  }

  t.is(queuePeekResp.ok.length, cargoItems.length)
})

test('can insert partially same batch to the content queue and only peek once same items', async t => {
  const { dbClient } = t.context
  const contentQueue = createContentQueue(dbClient)
  const cargoItems = await getCargo(20)
  const cargoItems0 = cargoItems.slice(0, 15)
  const cargoItems1 = cargoItems.slice(4)

  // Put content
  const queuePutResp0 = await Promise.all(
    cargoItems0.map(item => contentQueue.put(item.content))
  )
  t.falsy(queuePutResp0.find(resp => resp.error))
  // Put partially same content
  const queuePutResp1 = await Promise.all(
    cargoItems1.map(item => contentQueue.put(item.content))
  )
  t.falsy(queuePutResp1.find(resp => resp.error))

  // Peek content
  const queuePeekResp = await contentQueue.peek()
  if (!queuePeekResp.ok) {
    throw new Error('no queued items after insert')
  }

  t.is(queuePeekResp.ok.length, cargoItems.length)
})

test('fails to insert to content queue if invalid URL is provided in source', async t => {
  const { dbClient } = t.context
  const contentQueue = createContentQueue(dbClient)
  const [cargo] = await getCargo(1)

  const { error } = await contentQueue.put({
    ...cargo.content,
    // @ts-expect-error this is purposely not URL
    source: ['not-a-url']
  })

  t.truthy(error)
  t.is(error?.name, ContentEncodeErrorName)
})
