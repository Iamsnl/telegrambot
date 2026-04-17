module.exports = {
  apps: [{
    name: "telegram-bot",
    script: "src/index.js",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "4G", // Optimized for 8GB RAM VPS
    env: {
      NODE_ENV: "production",
    }
  }]
};
