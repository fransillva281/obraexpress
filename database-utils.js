function toPostgresSql(sql) {
  let parameter = 0;
  return sql.replace(/\?/g, () => `$${++parameter}`);
}

function isUniqueViolation(error) {
  return error?.code === '23505';
}

function buildRunSql(sql) {
  let query = toPostgresSql(sql);
  if (/^\s*INSERT\s+INTO/i.test(query) && !/\bRETURNING\b/i.test(query)) {
    query += ' RETURNING id';
  }
  return query;
}

module.exports = {
  buildRunSql,
  isUniqueViolation,
  toPostgresSql
};
