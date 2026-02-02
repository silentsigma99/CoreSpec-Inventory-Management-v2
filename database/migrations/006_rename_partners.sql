-- Rename Partner A and Partner B warehouses to CarProofing and Delta Sonic

-- Update Partner A
UPDATE warehouses 
SET name = 'CarProofing' 
WHERE name = 'Partner A - Downtown';

-- Update Partner B
UPDATE warehouses 
SET name = 'Delta Sonic' 
WHERE name = 'Partner B - Westside';

-- Also handle cases where they might have been manually renamed slightly differently or to ensure we catch them all if we search by ID (optional but safer if strict IDs are known)
-- But relying on name here as per original file references.
