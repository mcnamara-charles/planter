// Cross-platform icon shim with MaterialIcons + Entypo support,
// including an Entypo "cycle" icon that you can reference as name="cycle".

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Entypo from '@expo/vector-icons/Entypo';
import AntDesign from '@expo/vector-icons/AntDesign';
import { SymbolWeight } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

// Per-library name types
type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];
type EntypoIconName = ComponentProps<typeof Entypo>['name'];
type AntIconName = ComponentProps<typeof AntDesign>['name'];

type IconDescriptor =
  | { lib: 'material'; name: MaterialIconName }
  | { lib: 'entypo'; name: EntypoIconName }
  | { lib: 'ant'; name: AntIconName };


// Map any public string key → concrete library + glyph name
const MAPPING: Record<string, IconDescriptor> = {
  // existing mappings…
  'house.fill': { lib: 'material', name: 'home' },
  'paperplane.fill': { lib: 'material', name: 'send' },
  'chevron.left': { lib: 'material', name: 'chevron-left' },
  'arrow.left': { lib: 'material', name: 'arrow-back' },
  'arrow.clockwise': { lib: 'material', name: 'refresh' },
  grid: { lib: 'material', name: 'grid-view' },
  list: { lib: 'material', name: 'view-list' },
  leaf: { lib: 'material', name: 'eco' },
  star: { lib: 'material', name: 'star' },
  'chevron.left.forwardslash.chevron.right': { lib: 'material', name: 'code' },
  'chevron.right': { lib: 'material', name: 'chevron-right' },
  'chevron.down': { lib: 'entypo', name: 'chevron-down' },
  'chevron.up': { lib: 'entypo', name: 'chevron-up' },
  'camera.fill': { lib: 'material', name: 'photo-camera' },
  photo: { lib: 'material', name: 'photo' },
  pencil: { lib: 'material', name: 'edit' },
  'trash.fill': { lib: 'material', name: 'delete' },
  'xmark.circle.fill': { lib: 'material', name: 'cancel' },
  openai: { lib: 'ant', name: 'open-ai' },
  // new ones
  heart: { lib: 'material', name: 'favorite-border' },
  'heart.fill': { lib: 'material', name: 'favorite' },
  'ellipsis.vertical': { lib: 'material', name: 'more-vert' },
  ellipsis: { lib: 'material', name: 'more-horiz' },
  'person.circle': { lib: 'material', name: 'person' },
  plus: { lib: 'material', name: 'add' },
  // Account & settings icons
  gearshape: { lib: 'material', name: 'settings' },
  bell: { lib: 'material', name: 'notifications' },
  lock: { lib: 'material', name: 'lock' },
  'questionmark.circle': { lib: 'material', name: 'help-outline' },
  'rectangle.portrait.and.arrow.right': { lib: 'material', name: 'logout' },
  'doc.on.doc': { lib: 'material', name: 'content-copy' },

  // ---- PlantTimeline event icons (Material) ----
  drop: { lib: 'material', name: 'opacity' }, // water droplet
  bolt: { lib: 'material', name: 'bolt' }, // lightning bolt
  location: { lib: 'material', name: 'place' }, // location pin
  scissors: { lib: 'material', name: 'content-cut' }, // scissors
  clock: { lib: 'material', name: 'schedule' }, // clock/time
  eye: { lib: 'material', name: 'visibility' }, // eye/observe

  // ---- Dashboard icons ----
  'exclamationmark.triangle': { lib: 'material', name: 'warning' }, // warning triangle
  checklist: { lib: 'material', name: 'checklist' }, // checklist

  // ---- Entypo addition ----
  // Use this from your app as <IconSymbol name="cycle" />
  cycle: { lib: 'entypo', name: 'cycle' },
};

// Drive the public prop name from the keys of our mapping
export type IconSymbolName = keyof typeof MAPPING;

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight; // kept for API parity; unused with Material/Entypo
}) {
  const entry = MAPPING[name];

  if (!entry) {
    // Fallback to a helpful Material outline if a bad key slips in
    return <MaterialIcons color={color} size={size} name="help-outline" style={style} />;
  }
  if (entry.lib === 'entypo') {
    return <Entypo color={color} size={size} name={entry.name} style={style} />;
  }
  if (entry.lib === 'ant') {
    return <AntDesign color={color} size={size} name={entry.name} style={style} />;
  }

  // default: material
  return <MaterialIcons color={color} size={size} name={entry.name} style={style} />;
}