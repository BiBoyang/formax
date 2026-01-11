#!/usr/bin/env node

import 'dotenv/config'
import { createApp } from '../core/app/createApp.js'
import { runLegacyCli } from '../legacy/runLegacyCli.js'

const app = createApp()

runLegacyCli({ app }).catch((err) => {
  console.error(err)
  process.exit(1)
})
