import { Table, use } from '@serverless-stack/resources'
import { StartingPosition } from 'aws-cdk-lib/aws-lambda'

import { RedisStack } from './redis-stack.js'
import { carTableProps, aggregateTableProps } from '../data/tables/index.js'
import {
  getRedisLambdaRole,
  getAggregateConfig,
  setupSentry,
  AGGREGATE_KEY
} from './config.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function DataStack({ stack, app }) {
  stack.setDefaultFunctionProps({
    srcPath: 'data'
  })

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Get references to constructs created in other stacks
  const {
    redisVpc,
    redisEndpoint,
    redisPort,
    redisSecurityGroup,
  }  = use(RedisStack)

  // Create role with required policies for lambda to interact with redis cluster
  const role = getRedisLambdaRole(stack)

  /**
   * This table tracks CARs pending a Filecoin deal, including their metadata.
   */
  const carTable = new Table(stack, 'car', {
    ...carTableProps,
    // information that will be written to the stream
    stream: 'new_image',
  })

  /**
   * This table tracks CARs pending a Filecoin deal, including their metadata.
   */
  const aggregateTable = new Table(stack, 'aggregate', {
    ...aggregateTableProps,
    // information that will be written to the stream
    stream: 'new_and_old_images'
  })

  const aggregateConfig = getAggregateConfig(stack)

  // car dynamodb table stream consumers
  carTable.addConsumers(stack, {
    // Car table stream consumer for aggregation
    addCarsToAggregate: {
      function: {
        handler: 'functions/add-cars-to-aggregate.consumer',
        environment: {
          AGGREGATE_TABLE_NAME: aggregateTable.tableName,
          AGGREGATE_MIN_SIZE: aggregateConfig.aggregateMinSize,
          AGGREGATE_MAX_SIZE: aggregateConfig.aggregateMaxSize,
          REDIS_URL: redisEndpoint,
          REDIS_PORT: `${redisPort}`,
          REDIS_KEY: AGGREGATE_KEY
        },
        permissions: [aggregateTable],
        role,
        vpc: redisVpc,
        securityGroups: [redisSecurityGroup],
        timeout: 3 * 60,
      },
      cdk: {
        // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_event_sources.DynamoEventSourceProps.html#filters
        eventSource: {
          batchSize: 50,
          // Start reading at the last untrimmed record in the shard in the system.
          startingPosition: StartingPosition.TRIM_HORIZON,
          // If the function returns an error, split the batch in two and retry.
          bisectBatchOnError: true,
          maxBatchingWindow: aggregateConfig.maxBatchingWindow,
          // TODO: Add error queue
          // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_event_sources.DynamoEventSourceProps.html#onfailure
        }
      },
      filters: [
        {
          eventName: ['INSERT']
        }
      ]
    },
  })

  // Aggregate state machine
  // INGESTING -> READY = state change + redis aggregate ID update
  // READY -> DEAL_PENDING = request Spade
  // DEAL_PENDING -> DEAL_PROCESSED = deal succeeded + GC

  // aggregate dynamodb table stream consumers
  aggregateTable.addConsumers(stack, {
    // Aggregate table stream consumer for requesting deals on ready
    setAggregateAsReady: {
      function: {
        handler: 'functions/set-aggregate-as-ready.consumer',
        environment: {
          AGGREGATE_TABLE_NAME: aggregateTable.tableName,
          AGGREGATE_MIN_SIZE: aggregateConfig.aggregateMinSize,
          AGGREGATE_MAX_SIZE: aggregateConfig.aggregateMaxSize,
          REDIS_URL: redisEndpoint,
          REDIS_PORT: `${redisPort}`,
          REDIS_KEY: AGGREGATE_KEY
        },
        permissions: [aggregateTable],
        role,
        vpc: redisVpc,
        securityGroups: [redisSecurityGroup],
        timeout: 15 * 60,
      },
      cdk: {
        eventSource: {
          batchSize: 1,
          // Start reading at the last untrimmed record in the shard in the system.
          startingPosition: StartingPosition.TRIM_HORIZON,
          // TODO: Add error queue
          // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_event_sources.DynamoEventSourceProps.html#onfailure
        }
      },
      filters: [
        // Trigger when there is enough data abd state is ingesting
        {
          dynamodb: {
            NewImage: {
              // TODO: we need to do this filtering inside lambda for now...
              // https://repost.aws/questions/QUxxQDRk5mQ22jR4L3KsTkKQ/dynamo-db-streams-filter-with-nested-fields-not-working
              // size: {
              //   N: ['>', Number(aggregateConfig.aggregateMinSize)]
              // },
              stat: {
                S: ['INGESTING']
              }
            }
          }
        }
      ]
    },
  })

  return {
    carTable,
    aggregateTable,
  }
}
