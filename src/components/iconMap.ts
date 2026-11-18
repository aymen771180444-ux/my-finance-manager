import {
  Banknote, Briefcase, Building2, Car, CarTaxiFront, ChefHat, CirclePlus, Coffee, Droplets, Fuel, Gamepad2, Gift,
  GraduationCap, Hammer, HeartPulse, Home, Phone, PiggyBank, Plane, Receipt, RefreshCw, Shapes, ShoppingBag,
  ShoppingBasket, Siren, Smartphone, Store, TrendingUp, Users, UtensilsCrossed, Wifi, Wrench, Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Explicit icon registry for categories. Importing lucide's full `icons` object
 * pulls ~1,500 icons into the bundle; categories only ever use these.
 * Unknown names fall back to Shapes.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Banknote, Briefcase, Building2, Car, CarTaxiFront, ChefHat, CirclePlus, Coffee, Droplets, Fuel, Gamepad2, Gift,
  GraduationCap, Hammer, HeartPulse, Home, Phone, PiggyBank, Plane, Receipt, RefreshCw, Shapes, ShoppingBag,
  ShoppingBasket, Siren, Smartphone, Store, TrendingUp, Users, UtensilsCrossed, Wifi, Wrench, Zap,
};

/** Icons offered in the category editor. */
export const PICKER_ICONS = [
  'Shapes', 'ShoppingBag', 'UtensilsCrossed', 'Coffee', 'Car', 'Fuel', 'Home', 'HeartPulse', 'GraduationCap', 'Users',
  'Gift', 'Briefcase', 'Banknote', 'Receipt', 'Plane', 'Gamepad2', 'PiggyBank', 'Zap', 'Wifi', 'Phone', 'Store', 'TrendingUp',
];
