'use strict';

const assert = require('assert');
const {
  normalizeOfficialAttorney,
  findRegionId,
} = require('../src/services/e-advokat-registry');

const profile = normalizeOfficialAttorney({
  id: 77,
  fullName: "BOLTABOYEV AXRORJON XAYDARJON O'G'LI",
  status: 'LICENSED',
  mobilePhone: '+998 90 953-91-76',
  contragentName: 'VERITAS INTER LEX',
  contragentAddress: "Chilonzor tumani, Seul ko'chasi 16-uy",
  regionParentNameLt: 'Toshkent shahar',
  regionNameLt: 'Chilonzor tumani',
  licenseSerialTitle: 'L',
  regNumber: '70661486',
  beginDate: '12-01-2022',
  licenseTypeNameLt: 'Ma’muriy va jinoyiy sud ishlarini yuritish; Fuqarolik va iqtisodiy sud ishlarini yuritish',
}, [{ nameLt: 'Jinoyat huquqi' }]);

assert.strictEqual(profile.source, 'e_advokat');
assert.strictEqual(profile.source_id, '77');
assert.strictEqual(profile.license_status, 'active');
assert.strictEqual(profile.license_number, 'L - 70661486');
assert.strictEqual(profile.license_issued_on, '2022-01-12');
assert.strictEqual(profile.contact_phone, '+998 90 953-91-76');
assert.ok(profile.practice_areas.some(area => /Jinoyat huquqi/.test(area.name_uz)));
assert.ok(!Object.prototype.hasOwnProperty.call(profile, 'passportNumber'));
assert.ok(!Object.prototype.hasOwnProperty.call(profile, 'inps'));

const regions = [{ id: 1, nameLt: 'Toshkent shahar', children: [{ id: 2, nameLt: 'Chilonzor tumani' }] }];
assert.strictEqual(findRegionId(regions, 'Chilonzor'), 2);
assert.strictEqual(findRegionId(regions, 'Toshkent shahar'), 1);

const inactive = normalizeOfficialAttorney({ id: 2, fullName: 'Inactive', status: 'LICENSE_PAUSED' });
assert.strictEqual(inactive.license_status, 'inactive');

console.log('e-advokat-registry: all tests passed');
