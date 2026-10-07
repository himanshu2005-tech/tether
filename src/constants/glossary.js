// Plain-language explanations shown by the "i" buttons. Written so a student with no
// business background can follow: what it is, then why it matters.

export const GLOSSARY = {
  tender: 'A public request from a company saying "we want to buy this". Suppliers read it and offer their price. Think of it like posting a job and letting people apply.',
  bid: 'A supplier\'s offer for a tender: the price they will charge, how much they can supply, and how fast they can deliver.',
  contract: 'The agreement made when a buyer picks a bid. It locks in the price and quantity, so both sides know exactly what was promised.',
  invoice: 'A bill the supplier sends asking to be paid for what they delivered.',
  award: 'Choosing the winning bid. That supplier gets the order and a contract is created automatically.',
  maxUnitPrice: 'The most you are willing to pay for one unit (for example, one ton). Bids above this are flagged.',
  bidDeadline: 'The last date suppliers can send their offers.',
  deliveryBy: 'The date the goods must reach you.',
  contractTerms: 'The rules of the deal in plain words: when you pay, what quality you expect, whether extra charges are allowed. The AI reads these and checks every bill against them.',
  agreedPrice: 'The price per unit that both sides agreed on. The supplier should never bill more than this.',
  invoiced: 'How much of the contracted quantity the supplier has already billed for, out of the total allowed.',
  extraCharges: 'Anything added on top of the product price, such as transport or packing. Some contracts do not allow these, and the AI checks.',
  leakage: 'Money a company loses by paying more than it should, for example paying the same bill twice or paying above the agreed price. It "leaks" out quietly.',
  leakageStopped: 'The money that would have been lost if the flagged bills had been paid without checking.',
  riskScore: 'A number from 0 to 100 showing how suspicious something looks. 0–24 is safe, 25–59 needs a quick look, and 60 or more is held until you decide.',
  autoCleared: 'Bills that matched the contract perfectly, so the AI approved them without bothering you.',
  reviewQueue: 'Bills the AI found something odd about. Read the reason, then approve or reject each one.',
  valueScore: 'An overall score out of 100 that mixes price (cheaper is better), delivery speed and risk. Higher means a better deal.',
  recommended: 'The bid the AI thinks gives the best deal after weighing price, delivery time and risk.',
  bidEvaluation: 'The AI compares all bids side by side and looks for warning signs, such as two suppliers who secretly belong to the same owner.',
  priceGuidance: 'A price suggestion from the AI, based on what similar contracts sold for before, so your bid is neither too high to win nor too low to be trusted.',
  competitiveRange: 'The price window where most winning bids fall. Bidding inside it gives you a fair chance of winning.',
  anomaly: 'Something that does not fit the usual pattern. The AI learns what your normal bills look like and flags ones that stand out.',
  supplierRisk: 'How often each supplier\'s bills have been flagged. A supplier with many flags deserves a closer look.',
  gstin: 'Goods and Services Tax Identification Number: a unique 15-character ID every registered Indian business has.',
  keyPeople: 'The owners or directors who run the company. If the same person runs two "competing" suppliers, the competition is fake.',
  bankAccount: 'Used only to match companies. If a supplier gets paid into the same account as one of your own staff, that is a red flag.',
  businessDetails: 'Optional details the AI uses to find hidden links between companies, for example a supplier registered at the same address as a buyer.',
  briefing: 'A short summary the AI writes from your latest numbers, telling you what needs attention first.',
  termsSummary: 'The AI read the contract terms and turned them into rules it can check automatically on every bill.'
};

// Explanations for each kind of warning the AI can raise
export const FLAG_GLOSSARY = {
  price_exceeded: 'The supplier charged more per unit than the contract allows.',
  quantity_exceeded: 'The supplier is billing for more items than the contract covers in total.',
  extra_charges_not_allowed: 'The contract says no extra charges, but some were added anyway.',
  extra_charges_exceeded: 'Extra charges are allowed, but these go over the limit in the contract.',
  extra_charges_unverified: 'Extra charges were added and the contract does not clearly say whether that is allowed. Worth checking.',
  possible_duplicate: 'This bill looks almost the same as an earlier one. Paying both would mean paying twice for the same goods.',
  statistical_anomaly: 'The AI compared this bill with your past bills and it looks unusual in size, price or extra charges.',
  buyer_conflict: 'This supplier shares details (address, bank account, phone or people) with your own company. It could be secretly owned by an employee.',
  linked_bidders: 'Two bidders share details such as a bank account or address, so they may be the same company pretending to compete.',
  similar_proposals: 'Two suppliers wrote almost the same proposal. Real competitors rarely do that; it can mean they planned their bids together.',
  price_clustering: 'All bids are nearly the same price. In real competition prices usually spread out; tight grouping can mean price-fixing.',
  price_too_low: 'Much cheaper than normal. A supplier may bid low to win, then add charges later.',
  price_too_high: 'Much more expensive than what this product usually costs.',
  over_budget: 'This bid is above the maximum price you set.',
  partial_quantity: 'This supplier cannot deliver the full amount you asked for.',
  supplier_history: 'Many of this supplier\'s past bills were flagged, so be careful.'
};

export const SEVERITY_GLOSSARY = {
  high: 'High: likely to cost you money. Check before paying.',
  medium: 'Medium: something is off and worth a quick look.',
  low: 'Low: just so you know. Usually fine.'
};

