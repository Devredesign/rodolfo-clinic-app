-- Inventory purchase flow + manual adjustments + low-stock CRM tasks.
-- Applied to Supabase project dmxubpoxuokvmrmffxtb on 2026-08-25.

alter table public.expenses add column if not exists source_type text, add column if not exists source_id uuid;

-- sync_low_stock_task:
-- * creates one automatic pending Inventory task per product when stock <= minimum
-- * auto-completes that generated alert when stock rises above the minimum
-- register_inventory_purchase:
-- * creates purchase + purchase items
-- * creates one closed inventory container per purchased unit/vial
-- * records inventory movement
-- * updates product current cost and price history (CRC converted using current org FX snapshot)
-- * creates the matching Insumos expense and, when already paid, its expense_payment
-- * refreshes the low-stock CRM alert
-- adjust_inventory:
-- * positive adjustment creates closed inventory units
-- * negative adjustment discards open units first, then closed units
-- * records an auditable movement and refreshes low-stock CRM alert

-- Full function definitions are intentionally kept in the applied Supabase migration history.
-- This repository note documents the architectural behavior and the migration checkpoint.
