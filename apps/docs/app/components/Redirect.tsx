'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function Redirect({ href }: { href: string }) {
  const router = useRouter()
  useEffect(() => {
    router.replace(href)
  }, [href, router])
  return null
}
