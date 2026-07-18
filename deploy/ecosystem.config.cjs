// ============================================================
// PM2 Ecosystem — POS Barokah Backend
// Jalankan: pm2 start deploy/ecosystem.config.cjs
// ============================================================

module.exports = {
  apps: [
    {
      name        : 'mris-project-backend',
      script      : 'src/server.js',
      cwd         : '/var/www/mris-project/backend',
      instances   : 1,          // Ganti ke 'max' jika ingin cluster mode
      exec_mode   : 'fork',     // Ganti ke 'cluster' jika instances > 1
      watch       : false,      // Jangan watch di production

      // ── Environment Production ──────────────────────────
      env_production: {
        NODE_ENV: 'production',
      },

      // ── Restart Policy ──────────────────────────────────
      max_restarts       : 10,
      min_uptime         : '10s',
      restart_delay      : 3000,

      // ── Log ─────────────────────────────────────────────
      error_file         : '/var/log/pm2/mris-project-backend-error.log',
      out_file           : '/var/log/pm2/mris-project-backend-out.log',
      log_date_format    : 'YYYY-MM-DD HH:mm:ss',
      merge_logs         : true,
    },
  ],
};
