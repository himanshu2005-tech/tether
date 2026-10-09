import { INDUSTRIES, PREDEFINED_PRODUCTS, industryOf, inPlayArea, tenderIndustry } from './products';

test('every product belongs to exactly one industry', () => {
  expect(new Set(PREDEFINED_PRODUCTS).size).toBe(PREDEFINED_PRODUCTS.length);
  expect(INDUSTRIES.length).toBeGreaterThan(10);
});

test('laptops and computers sit under Computers & IT', () => {
  expect(industryOf('Laptops')).toBe('it');
  expect(industryOf('laptop')).toBe('it');
  expect(industryOf('Desktop Computers')).toBe('it');
  expect(industryOf('Unknown Widget')).toBeNull();
});

test('older tenders without an industry are classified from their product', () => {
  expect(tenderIndustry({ productName: 'Steel Beams' })).toBe('metals');
  expect(tenderIndustry({ productName: 'Laptops', industry: 'it' })).toBe('it');
});

test('suppliers only see tenders in their play area', () => {
  const steelSupplier = { industries: ['metals'] };
  expect(inPlayArea({ productName: 'Steel Beams' }, steelSupplier)).toBe(true);
  expect(inPlayArea({ productName: 'Laptops' }, steelSupplier)).toBe(false);
  expect(inPlayArea({ industry: 'it', productName: 'Custom laptop bag' }, steelSupplier)).toBe(false);
});

test('suppliers without a play area, and unclassified tenders, are not hidden', () => {
  expect(inPlayArea({ productName: 'Laptops' }, { industries: [] })).toBe(true);
  expect(inPlayArea({ productName: 'Something new' }, { industries: ['metals'] })).toBe(true);
});
