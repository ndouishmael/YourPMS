/**
 * Seed: reference catalogues (ICD-10 subset, SAMA-style GP tariff items,
 * South African medical schemes & options) plus an optional platform admin.
 *
 * Catalogue prices are representative Phase-1 defaults for the GP tariff
 * codes commonly claimed in SA private practice; practices can override line
 * prices at charge capture.
 */
import Database from 'better-sqlite3';
import { migrate } from './migrate';

function getDbPath(): string {
  return process.env.DATABASE_PATH ?? './data/yourpms.db';
}

const ICD10 = [
  ['A09', 'Infectious gastroenteritis and colitis', 'I'],
  ['B54', 'Malaria, unspecified', 'I'],
  ['E03.9', 'Hypothyroidism, unspecified', 'IV'],
  ['E11.9', 'Type 2 diabetes mellitus without complications', 'IV'],
  ['E66.9', 'Obesity, unspecified', 'IV'],
  ['E78.5', 'Hyperlipidaemia, unspecified', 'IV'],
  ['F32.9', 'Depressive episode, unspecified', 'V'],
  ['F41.9', 'Anxiety disorder, unspecified', 'V'],
  ['F51.0', 'Non-organic insomnia', 'V'],
  ['G43.9', 'Migraine, unspecified', 'VI'],
  ['H10.9', 'Conjunctivitis, unspecified', 'VII'],
  ['H66.9', 'Otitis media, unspecified', 'VIII'],
  ['I10', 'Essential (primary) hypertension', 'IX'],
  ['I25.1', 'Atherosclerotic heart disease', 'IX'],
  ['J02.9', 'Acute pharyngitis, unspecified', 'X'],
  ['J03.9', 'Acute tonsillitis, unspecified', 'X'],
  ['J06.9', 'Acute upper respiratory infection, unspecified', 'X'],
  ['J18.9', 'Pneumonia, unspecified organism', 'X'],
  ['J20.9', 'Acute bronchitis, unspecified', 'X'],
  ['J45.9', 'Asthma, unspecified', 'X'],
  ['K02.1', 'Dental caries with pulp involvement', 'XI'],
  ['K29.7', 'Gastritis, unspecified', 'XI'],
  ['K52.9', 'Noninfective gastroenteritis and colitis, unspecified', 'XI'],
  ['L23.9', 'Allergic contact dermatitis, unspecified cause', 'XII'],
  ['L50.9', 'Urticaria, unspecified', 'XII'],
  ['M06.9', 'Rheumatoid arthritis, unspecified', 'XIII'],
  ['M54.5', 'Low back pain', 'XIII'],
  ['M79.1', 'Myalgia', 'XIII'],
  ['N39.0', 'Urinary tract infection, site not specified', 'XIV'],
  ['N76.0', 'Acute vaginitis', 'XIV'],
  ['O28.9', 'Abnormal finding on antenatal screening, unspecified', 'XV'],
  ['R05', 'Cough', 'XVIII'],
  ['R07.4', 'Chest pain, unspecified', 'XVIII'],
  ['R10.9', 'Unspecified abdominal pain', 'XVIII'],
  ['R50.9', 'Fever, unspecified', 'XVIII'],
  ['R51', 'Headache', 'XVIII'],
  ['S93.4', 'Sprain of ankle', 'XIX'],
  ['S61.0', 'Open wound of finger(s) without damage to nail', 'XIX'],
  ['T78.1', 'Other adverse food reactions, not elsewhere classified', 'XIX'],
  ['U07.1', 'COVID-19, virus identified', 'U'],
  ['Z00.0', 'General medical examination', 'XXI'],
  ['Z23', 'Immunization appropriate age', 'XXI'],
  ['Z34.0', 'Supervision of normal first pregnancy', 'XXI'],
];

const TARIFFS: Array<[string, string, number, string]> = [
  // code, description, default price cents, category
  ['0190', 'Consultation — surgery hours, established patient', 55000, 'CONSULTATION'],
  ['0191', 'Consultation — surgery hours, new patient', 65000, 'CONSULTATION'],
  ['0192', 'Consultation — after hours', 85000, 'CONSULTATION'],
  ['0194', 'Repeat consultation (follow-up within 30 days)', 35000, 'CONSULTATION'],
  ['0181', 'Telephone consultation', 30000, 'CONSULTATION'],
  ['0127', 'Injection — administration', 12000, 'PROCEDURE'],
  ['0180', 'Venepuncture (drawing of blood)', 9000, 'PROCEDURE'],
  ['2522', 'ECG — resting, interpretation and report', 45000, 'PROCEDURE'],
  ['3705', 'Spirometry', 40000, 'PROCEDURE'],
  ['1700', 'Sutures — wound closure, up to 5cm', 42000, 'PROCEDURE'],
  ['1712', 'Wound care and dressing', 15000, 'PROCEDURE'],
  ['0129', 'Nebulization', 18000, 'PROCEDURE'],
  ['2051', 'Removal of foreign body — simple', 25000, 'PROCEDURE'],
  ['1361', 'Cerumen removal (ear syringing)', 18000, 'PROCEDURE'],
  ['1380', 'Urinalysis (dipstick)', 7000, 'INVESTIGATION'],
  ['3725', 'Rapid strep / flu / COVID point-of-care test', 22000, 'INVESTIGATION'],
  ['0195', 'Medical certificate / report', 15000, 'ADMIN'],
  ['9010', 'Drivers licence medical examination', 60000, 'ADMIN'],
  ['9011', 'Insurance medical report', 45000, 'ADMIN'],
  ['0165', 'Chronic medication prescription review', 28000, 'CONSULTATION'],
];

const SCHEMES: Array<{ name: string; code: string; options: Array<[string, string]> }> = [
  { name: 'Discovery Health Medical Scheme', code: 'DISCOVERY', options: [['KEYCARE', 'KeyCare Series'], ['SMART', 'Smart Plan'], ['CORE', 'Core Series'], ['SAVINGS', 'Saver / Savings Series'], ['PRIORITY', 'Priority Series'], ['EXECUTIVE', 'Executive Series'], ['TOP', 'Comprehensive / Top Series']] },
  { name: 'Bonitas Medical Fund', code: 'BONITAS', options: [['BONSTART', 'BonStart'], ['BONSELECT', 'BonSelect'], ['BONCLASSIC', 'BonClassic'], ['STANDARD', 'Standard'], ['BONCOMPLETE', 'BonComplete'], ['PREMIER', 'Premier Select']] },
  { name: 'GEMS (Government Employees Medical Scheme)', code: 'GEMS', options: [['TANZANITE', 'Tanzanite One'], ['BERYL', 'Beryl Value'], ['RUBY', 'Ruby Add On'], ['EMERALD', 'Emerald Value'], ['EMERALDPLUS', 'Emerald Plus'], ['ONYX', 'Onyx']] },
  { name: 'Momentum Health', code: 'MOMENTUM', options: [['CUSTOM', 'Custom'], ['INGWE', 'Ingwe Option'], ['KHANYA', 'Khanya Option'], ['EVOLVE', 'Evolve Option'], ['EXTEND', 'Extend Option'], ['SUMMIT', 'Summit Option']] },
  { name: 'Medshield Medical Scheme', code: 'MEDSHIELD', options: [['MSPOWER', 'PowerCore'], ['MSCORE', 'CoreCore'], ['MSPLUS', 'MediCore Plus'], ['MSELITE', 'EliteCore']] },
  { name: 'Bestmed Medical Scheme', code: 'BESTMED', options: [['R1', 'Beat1'], ['R2', 'Beat2'], ['R3', 'Beat3'], ['R4NET', 'Beat4 NetWork'], ['PACE1', 'Pace1'], ['PACE2', 'Pace2']] },
  { name: 'Fedhealth Medical Scheme', code: 'FEDHEALTH', options: [['MAXIMA', 'Maxima Exec'], ['MAXIMAS', 'Maxima Standard'], ['MAXIMAB', 'Maxima Basis'], ['MINIMA', 'Minima'], ['MYFED', 'myFED']] },
  { name: 'Profmed Medical Scheme', code: 'PROFMED', options: [['PROCSA', 'ProCSA'], ['PROCORE', 'ProCore'], ['PROSECURE', 'ProSecure'], ['PROPULSE', 'ProPulse']] },
];

export function seed(dbPath = getDbPath()) {
  migrate(dbPath);
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const existing = db.prepare('SELECT COUNT(*) AS n FROM icd10_codes').get() as { n: number };
  if (existing.n > 0) {
    return { skipped: true };
  }

  const insertIcd = db.prepare('INSERT OR IGNORE INTO icd10_codes (code, description, chapter) VALUES (?, ?, ?)');
  for (const [code, description, chapter] of ICD10) insertIcd.run(code, description, chapter);

  const insertTariff = db.prepare(
    'INSERT OR IGNORE INTO tariff_items (id, code, description, default_price_cents, category, is_active) VALUES (?, ?, ?, ?, ?, 1)',
  );
  let tarIdx = 0;
  for (const [code, description, price, category] of TARIFFS) {
    insertTariff.run(`tar_seed_${tarIdx++}`, code, description, price, category);
  }

  const insertScheme = db.prepare('INSERT OR IGNORE INTO medical_schemes (id, name, code, is_active) VALUES (?, ?, ?, 1)');
  const insertOption = db.prepare('INSERT OR IGNORE INTO medical_scheme_options (id, scheme_id, name, code) VALUES (?, ?, ?, ?)');
  for (const scheme of SCHEMES) {
    const schemeId = `sch_${scheme.code.toLowerCase()}`;
    insertScheme.run(schemeId, scheme.name, scheme.code);
    for (const [code, name] of scheme.options) {
      insertOption.run(`sco_${scheme.code.toLowerCase()}_${code.toLowerCase()}`, schemeId, name, code);
    }
  }

  db.close();
  return { skipped: false, icd10: ICD10.length, tariffs: TARIFFS.length, schemes: SCHEMES.length };
}

if (require.main === module) {
  const result = seed();
  console.log('[seed]', result.skipped ? 'catalogues already seeded — skipped' : JSON.stringify(result));
}
