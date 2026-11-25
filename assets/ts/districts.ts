import { Zone } from './types.js';

export function buildDistrictAverages(legacy: Zone[], places: Zone[]): Zone[] {
  const averages: Zone[] = [];
  legacy.forEach((zone) => {
    const members = places.filter((p) => p.kind !== 'estimate' && p.legacy_zone === zone.id);
    if (members.length < 2) {
      return;
    }
    const counts: { [name: string]: number } = {};
    members.forEach((p) => {
      const name = p.district || zone.name;
      counts[name] = (counts[name] || 0) + 1;
    });
    const district = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const home = members.find((p) => p.district === district) || members[0];
    averages.push({
      ...zone,
      name: `${district} District`,
      kind: 'district',
      district,
      division: home.division,
      sensors: members.length,
    });
  });
  return averages;
}
