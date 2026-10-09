// Industries ("play areas") and the products in each. Suppliers pick the industries they serve
// when they sign up, and only see tenders for products in those industries.

export const INDUSTRIES = [
  {
    id: 'metals',
    name: 'Metals & Raw Materials',
    products: ['Iron Ore', 'Steel Beams', 'Steel Sheets', 'TMT Bars', 'Copper Wire', 'Aluminium Sheets', 'Stainless Steel Pipes', 'Scrap Metal']
  },
  {
    id: 'construction',
    name: 'Construction Materials',
    products: ['Cement', 'Sand', 'Bricks', 'Concrete Blocks', 'Ready-Mix Concrete', 'Tiles', 'Paint', 'Plywood', 'Lumber', 'Glass Panels']
  },
  {
    id: 'it',
    name: 'Computers & IT',
    products: ['Laptops', 'Desktop Computers', 'Servers', 'Monitors', 'Printers', 'Keyboards & Mice', 'Networking Switches', 'Routers', 'Storage Drives', 'Software Licences']
  },
  {
    id: 'electronics',
    name: 'Electronic Components',
    products: ['Microchips', 'Motherboards', 'GPUs', 'Silicon Wafers', 'Displays', 'Sensors', 'Circuit Boards', 'Connectors']
  },
  {
    id: 'electrical',
    name: 'Electrical & Power',
    products: ['Electrical Cables', 'Networking Cables', 'Switchgear', 'Transformers', 'LED Lighting', 'Generators', 'UPS Systems', 'Solar Panels', 'Lithium Batteries']
  },
  {
    id: 'machinery',
    name: 'Machinery & Equipment',
    products: ['Electric Motors', 'Hydraulic Pumps', 'Air Compressors', 'Conveyor Belts', 'CNC Machines', 'Forklifts', 'Welding Machines', 'Bearings', 'Valves']
  },
  {
    id: 'packaging',
    name: 'Packaging & Logistics',
    products: ['Corrugated Boxes', 'Shipping Pallets', 'Bubble Wrap', 'Industrial Tape', 'Stretch Film', 'Plastic Crates', 'Freight Transport', 'Warehousing Services']
  },
  {
    id: 'chemicals',
    name: 'Chemicals & Plastics',
    products: ['Industrial Chemicals', 'Lubricants', 'Adhesives', 'Plastic Granules', 'PVC Pipes', 'Solvents', 'Fertilisers']
  },
  {
    id: 'textiles',
    name: 'Textiles & Apparel',
    products: ['Cotton Fabric', 'Yarn', 'Uniforms', 'Workwear', 'Bed Linen', 'Technical Textiles']
  },
  {
    id: 'office',
    name: 'Office Supplies & Furniture',
    products: ['Office Chairs', 'Desks', 'Filing Cabinets', 'Stationery', 'Printer Paper', 'Toner Cartridges']
  },
  {
    id: 'safety',
    name: 'Healthcare & Safety',
    products: ['Safety Helmets', 'Safety Gloves', 'Safety Shoes', 'Masks', 'First Aid Kits', 'Fire Extinguishers', 'Medical Consumables']
  },
  {
    id: 'food',
    name: 'Food & Agriculture',
    products: ['Rice', 'Wheat', 'Pulses', 'Edible Oil', 'Sugar', 'Packaged Water', 'Animal Feed']
  },
  {
    id: 'automotive',
    name: 'Automotive & Spare Parts',
    products: ['Tyres', 'Automotive Batteries', 'Engine Parts', 'Brake Components', 'Filters', 'Vehicle Lubricants']
  }
];

export const PREDEFINED_PRODUCTS = INDUSTRIES.flatMap(i => i.products);

const byProduct = new Map(INDUSTRIES.flatMap(i => i.products.map(p => [p.toLowerCase(), i.id])));

export const industryName = (id) => INDUSTRIES.find(i => i.id === id)?.name || 'Other';

// The industry a product belongs to, or null for a product we don't know
export function industryOf(product) {
  if (!product) return null;
  const key = String(product).toLowerCase().trim();
  if (byProduct.has(key)) return byProduct.get(key);
  // Tolerate small differences such as "Laptop" vs "Laptops"
  for (const [name, id] of byProduct) {
    if (name.replace(/s$/, '') === key.replace(/s$/, '')) return id;
  }
  return null;
}

// Industry of a tender: stored on new tenders, worked out from the product for older ones
export const tenderIndustry = (tender) => tender?.industry || industryOf(tender?.productName);

// Should this supplier see this tender? Suppliers who haven't picked industries yet see everything,
// and tenders for products we can't classify are shown to everyone.
export function inPlayArea(tender, userData) {
  const areas = userData?.industries;
  if (!areas || !areas.length) return true;
  const industry = tenderIndustry(tender);
  return !industry || areas.includes(industry);
}

// All product names a supplier deals in, based on their industries
export const productsForIndustries = (ids = []) =>
  INDUSTRIES.filter(i => ids.includes(i.id)).flatMap(i => i.products);
