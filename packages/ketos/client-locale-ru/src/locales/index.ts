/**
 * Russian dictionary pair this package owns. Key sets are checked against the
 * locale package's en dictionaries by the tests, not by the compiler: the
 * per-locale `LocaleRuntime.register` form accepts partial dictionaries, but
 * the Ketos common dictionary is complete by contract.
 */
export { ru } from './common-ru.ts'
export { ru as settingsRu } from './settings-ru.ts'
