import { Tags } from 'aws-cdk-lib'
import { ApiStack } from './api-stack.js'
import { DataStack } from './data-stack.js'

/**
 * @param {import('@serverless-stack/resources').App} app
 */
export default function (app) {
  app.setDefaultFunctionProps({
    runtime: 'nodejs16.x',
    environment: {
      // experimental fetch is needed so that we can use aggregate-client
      // with ucanto client without passing a fetch implementation around
      NODE_OPTIONS: "--enable-source-maps  --experimental-fetch",
    },
    bundle: {
      format: 'esm',
      sourcemap: true,
    },
  })
  app.stack(ApiStack)
  app.stack(DataStack)

  // tags let us discover all the aws resource costs incurred by this app
  // see: https://docs.sst.dev/advanced/tagging-resources
  Tags.of(app).add('Project', 'w3filecoin')
  Tags.of(app).add('Repository', 'https://github.com/web3-storage/w3filecoin')
  Tags.of(app).add('Environment', `${app.stage}`)
  Tags.of(app).add('ManagedBy', 'SST')
}
