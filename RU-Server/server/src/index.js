require('dotenv').config();

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { initStorage } = require('./lib/storage');
const uploadsRouter = require('./routes/uploads');
const linksRouter = require('./routes/links');
const publicRouter = require('./routes/public');

async function bootstrap() {
  await initStorage();

  const app = express();
  app.disable('x-powered-by');
  app.use(morgan('combined'));
  app.use(express.json({ limit: '5mb' }));
  app.use(cors());
  app.use('/files', express.static(path.join(config.storageRoot, 'files'), { fallthrough: true }));

  app.use(uploadsRouter);
  app.use(linksRouter);
  app.use(publicRouter);

  app.use((err, _req, res, _next) => {
    console.error('[server] unhandled error', err);
    res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  });

  app.listen(config.port, () => {
    console.log(`[cn-server] listening on port ${config.port}`);
  });
}

bootstrap().catch((error) => {
  console.error('[server] failed to start', error);
  process.exit(1);
});
