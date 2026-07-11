const knex = require("knex");
const config = require("../../knexfile");
const env = require("../config/env");

const db = knex(config[env.nodeEnv] || config.development);

module.exports = db;
