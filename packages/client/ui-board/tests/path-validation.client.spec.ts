import { describe, expect, it } from 'vitest'
import { validateWorkspacePath } from '../src/client/window/path-validation.ts'
import type { BoardTranslate } from '../src/client/locale.ts'

const mockT: BoardTranslate = (key, params) => {
  return `${key}:${JSON.stringify(params ?? {})}`
}

describe('validateWorkspacePath', () => {
  const hostHome = '/Users/testuser'

  it('rejects an empty path with the empty-path message', () => {
    const result = validateWorkspacePath('  ', { hostHome, t: mockT })
    expect(result).toEqual({ kind: 'rejected', error: 'panel.error.emptyPath:{}' })
  })

  it('rejects ~/.ketos and subpaths', () => {
    expect(validateWorkspacePath('~/.ketos', { hostHome, t: mockT }).kind).toBe('rejected')
    expect(validateWorkspacePath('~/.ketos/sessions', { hostHome, t: mockT }).kind).toBe('rejected')
    expect(validateWorkspacePath('~\\.ketos\\sessions', { hostHome, t: mockT }).kind).toBe('rejected')
  })

  it('rejects ~/.dsh and subpaths', () => {
    expect(validateWorkspacePath('~/.dsh', { hostHome, t: mockT }).kind).toBe('rejected')
    expect(validateWorkspacePath('~/.dsh/plugins', { hostHome, t: mockT }).kind).toBe('rejected')
  })

  it('rejects hostHome/.ketos and subpaths', () => {
    expect(validateWorkspacePath('/Users/testuser/.ketos', { hostHome, t: mockT })).toEqual({
      kind: 'rejected',
      error: 'panel.error.ketosHome:{"path":"/Users/testuser/.ketos"}',
    })
    expect(validateWorkspacePath('/Users/testuser/.ketos/workspace', { hostHome, t: mockT }).kind).toBe('rejected')
  })

  it('rejects hostHome/.dsh and subpaths', () => {
    expect(validateWorkspacePath('/Users/testuser/.dsh', { hostHome, t: mockT }).kind).toBe('rejected')
    expect(validateWorkspacePath('/Users/testuser/.dsh/data', { hostHome, t: mockT }).kind).toBe('rejected')
  })

  it('leaves a runtime home the client cannot name to the host', () => {
    // The client knows no DSH_HOME: without hostHome the moved-root path is
    // not detectable here and stays valid for the host's own refusal.
    expect(validateWorkspacePath('/custom/dsh/home', { t: mockT }).kind).toBe('valid')
    expect(validateWorkspacePath('/custom/dsh/home/sub', { t: mockT }).kind).toBe('valid')
  })

  it('warns on filesystem root', () => {
    expect(validateWorkspacePath('/', { hostHome, t: mockT }).kind).toBe('warning')
    expect(validateWorkspacePath('///', { hostHome, t: mockT }).kind).toBe('warning')
    expect(validateWorkspacePath('C:/', { hostHome, t: mockT }).kind).toBe('warning')
    expect(validateWorkspacePath('C:\\\\', { hostHome, t: mockT }).kind).toBe('warning')
    expect(validateWorkspacePath('D:\\', { hostHome, t: mockT }).kind).toBe('warning')
  })

  it('warns on user home directory', () => {
    expect(validateWorkspacePath('~', { hostHome, t: mockT }).kind).toBe('warning')
    expect(validateWorkspacePath('~/', { hostHome, t: mockT }).kind).toBe('warning')
    expect(validateWorkspacePath('~//', { hostHome, t: mockT }).kind).toBe('warning')
    expect(validateWorkspacePath('/Users/testuser', { hostHome, t: mockT }).kind).toBe('warning')
    expect(validateWorkspacePath('/Users/testuser/', { hostHome, t: mockT }).kind).toBe('warning')
    expect(validateWorkspacePath('c:/users/testuser', { hostHome: 'C:/Users/testuser', t: mockT }).kind).toBe('warning')
  })

  it('rejects ~/.ketos with redundant slashes or Windows casing', () => {
    expect(validateWorkspacePath('~//.ketos', { hostHome, t: mockT }).kind).toBe('rejected')
    expect(validateWorkspacePath('c:\\users\\testuser\\.ketos\\work', { hostHome: 'C:/Users/testuser', t: mockT }).kind).toBe('rejected')
  })

  it('accepts ordinary project directories', () => {
    expect(validateWorkspacePath('/Users/testuser/projects/ketos', { hostHome, t: mockT }).kind).toBe('valid')
    expect(validateWorkspacePath('/var/www/site', { hostHome, t: mockT }).kind).toBe('valid')
    expect(validateWorkspacePath('C:\\workspace\\demo', { hostHome, t: mockT }).kind).toBe('valid')
  })
})
