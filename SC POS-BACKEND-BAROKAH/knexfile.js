const path = require("node:path");
const dotenv = require("dotenv");

const explicitEnv = { ...process.env };
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });
Object.assign(process.env, explicitEnv);

const baseConnection = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "pos_barokah",
  supportBigNumbers: true,
  dateStrings: true,
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 10000),
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

const createPoolConfig = (fallbackMax) => ({
  min: 0,
  max: Number(process.env.DB_CONNECTION_LIMIT || fallbackMax),
  acquireTimeoutMillis: Number(process.env.DB_ACQUIRE_TIMEOUT || 30000),
  createTimeoutMillis: Number(process.env.DB_CREATE_TIMEOUT || 30000),
  destroyTimeoutMillis: Number(process.env.DB_DESTROY_TIMEOUT || 5000),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT || 30000),
  reapIntervalMillis: Number(process.env.DB_REAP_INTERVAL || 10000),
  afterCreate: (connection, done) => {
    connection.on("error", (error) => {
      console.warn(`[mysql] connection error: ${error.code || error.message}`);
    });
    done(null, connection);
  }
});

module.exports = {
  development: {
    client: "mysql2",
    connection: baseConnection,
    pool: createPoolConfig(10),
    migrations: {
      directory: "./database/migrations"
    },
    seeds: {
      directory: "./database/seeds"
    }
  },
  production: {
    client: "mysql2",
    connection: process.env.DATABASE_URL || baseConnection,
    pool: createPoolConfig(5),
    migrations: {
      directory: "./database/migrations"
    },
    seeds: {
      directory: "./database/seeds"
    }
  },
  test: {
    client: "mysql2",
    connection: {
      ...baseConnection,
      database: process.env.DB_TEST_NAME || `${process.env.DB_NAME || "pos_barokah"}_test`
    },
    pool: createPoolConfig(10),
    migrations: {
      directory: "./database/migrations"
    },
    seeds: {
      directory: "./database/seeds"
    }
  }
};
