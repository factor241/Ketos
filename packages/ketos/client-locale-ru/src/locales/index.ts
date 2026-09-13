/**
 * Russian dictionary set this package owns. Key sets are checked against the
 * owning packages' en dictionaries by the compiler (`satisfies`) and the
 * tests: the per-locale `LocaleRuntime.register` form accepts partial
 * dictionaries, but the Ketos dictionaries are complete by contract.
 */
export { ru as boardRu } from './board-ru.ts'
export { ru } from './common-ru.ts'
export { ru as settingsRu } from './settings-ru.ts'
