// pm2 : EINK_NODE=/chemin/vers/node22 pm2 start ecosystem.config.cjs
// Un seul process (mode fork) : SQLite n'est pas fait pour tourner en cluster.
module.exports = {
  apps: [
    {
      name: 'ecran-eink',
      script: 'server/src/index.js',
      cwd: __dirname,
      interpreter: process.env.EINK_NODE || 'node', // Node >= 22 requis (node:sqlite)
      node_args: '--env-file-if-exists=.env',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '400M',
    },
  ],
}
