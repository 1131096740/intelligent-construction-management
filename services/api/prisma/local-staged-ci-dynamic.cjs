'use strict';

const { createLocalMigrationFixture } = require('./local-staged-migrations.cjs');
const { readbackWireLimit } = require('./local-staged-migration-controls.cjs');

const CI_DYNAMIC_MIGRATION_LABEL = 'jg.local-ci-dynamic-migration';
const requireOwned = condition => {
  if (!condition) throw new Error('LOCAL_CI_DYNAMIC_MIGRATION_RESOURCE');
};

function createCiDynamicMigrationFixture({ ciFixture, container, databaseNames, temporaryRoot, dockerCommand, deploy }) {
  const ownedContainer = Object.freeze({ ...container });
  const ownedDatabases = Object.freeze([...databaseNames]);
  async function inspectContainer(id) {
    requireOwned(id === ownedContainer.id);
    const result = await dockerCommand([
      'inspect', '--type', 'container', '--format',
      '{"id":{{json .Id}},"name":{{json .Name}},"runId":{{json (index .Config.Labels "' + CI_DYNAMIC_MIGRATION_LABEL +
      '")}},"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}}}',
      id
    ], { timeoutMs: 10_000, maxOutputBytes: 8192 });
    const observed = JSON.parse(result.stdout);
    const bindings = observed.ports?.['5432/tcp'];
    requireOwned(Object.keys(observed.ports ?? {}).length === 1 && Array.isArray(bindings) && bindings.length === 1);
    return {
      id: observed.id, name: observed.name?.replace(/^\//u, ''), runId: observed.runId,
      running: observed.running, publishedHost: bindings[0].HostIp, publishedPort: bindings[0].HostPort
    };
  }
  async function executeSql({ database, phase, sql }) {
    requireOwned(ownedDatabases.includes(database));
    return dockerCommand([
      'exec', '--interactive', ownedContainer.id, 'psql', '-h', '127.0.0.1', '-U', 'jiangkong', '-d', database,
      '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse', '-f', '-'
    ], { stdinText: sql, timeoutMs: 60_000, maxOutputBytes: phase === 'stage205-readback' ? readbackWireLimit : 512 * 1024 });
  }

  return createLocalMigrationFixture({
    ciFixture, container: ownedContainer, databaseNames: ownedDatabases, temporaryRoot, inspectContainer, executeSql, executeSqlStdin: executeSql, deploy
  });
}

module.exports = { CI_DYNAMIC_MIGRATION_LABEL, createCiDynamicMigrationFixture };
