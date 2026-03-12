import { useMDXComponents as getDocsMDXComponents } from 'nextra-theme-docs'

export function useMDXComponents(components?: Record<string, any>) {
  return getDocsMDXComponents({ ...components })
}
