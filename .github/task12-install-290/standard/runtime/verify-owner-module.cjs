'use strict';
const assert=require('node:assert/strict');
const {projectPsql}=require('./owner-observation.cjs');
const sample='ERROR:  42501: permission denied for relation private_fixture_relation\nprivate context';
const original=projectPsql(sample);
assert.deepEqual(original,{sqlstate:'42501',permissionDenied:true});
assert.deepEqual(projectPsql('unstructured private data'),{});
