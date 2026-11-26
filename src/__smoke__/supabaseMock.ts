// ---------------------------------------------------------------------------
// SMOKE TEST MOCK — yalnız vite.smoke.config.ts alias-ı ilə istifadə olunur.
// Real supabaseClient.ts ilə eyni interfeysi təqlid edir: chainable query
// builder + auth API. Heç bir şəbəkə çağırışı etmir.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>

type MockResult = {
  data: unknown
  error: { message: string; code?: string; status?: number } | null
}

const mockUser = {
  id: 'u-00000000-0000-0000-0000-000000000001',
  email: 'fidan@example.com',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: { full_name: 'Fidan Məmmədova' },
  created_at: '2026-01-01T00:00:00Z',
}

const DB = {
  profiles: [
    {
      id: mockUser.id,
      full_name: 'Fidan Məmmədova',
      bio: 'Kompyuter mühəndisliyi tələbəsi',
      avatar_url: null as string | null,
      university: 'Bakı Dövlət Universiteti',
      credit_balance: 35,
    },
  ],
  user_skills: [
    {
      id: 101,
      type: 'teach',
      level: 'advanced',
      description: 'React, hooks və komponent arxitekturası',
      skills: { id: 11, name: 'React Development', category: 'Proqramlaşdırma' },
    },
    {
      id: 102,
      type: 'teach',
      level: 'intermediate',
      description: 'Başlanğıc səviyyədə Python dərsləri',
      skills: { id: 12, name: 'Python', category: 'Proqramlaşdırma' },
    },
    {
      id: 103,
      type: 'learn',
      level: 'beginner',
      description: 'Figma ilə prototip qurmaq',
      skills: { id: 13, name: 'UI/UX dizayn', category: 'Dizayn' },
    },
  ],
  skills: [
    { id: 11, name: 'React Development', category: 'Proqramlaşdırma' },
    { id: 12, name: 'Python', category: 'Proqramlaşdırma' },
    { id: 13, name: 'UI/UX dizayn', category: 'Dizayn' },
  ],
  credit_transactions: [
    { id: 1, type: 'lesson_earned', amount: 24 },
    { id: 2, type: 'lesson_spent', amount: -18 },
  ],
  lesson_requests: { completedCount: 12 },
  reviews: [
    {
      id: 201,
      rating: 5,
      comment: 'Əla izah edir',
      created_at: '2026-11-01T10:00:00Z',
      reviewer: { id: 'u2', full_name: 'Lalə Əliyeva', avatar_url: null },
      skill: { id: 11, name: 'React Development' },
    },
    {
      id: 202,
      rating: 4,
      comment: 'Çox faydalı seans idi',
      created_at: '2026-10-20T10:00:00Z',
      reviewer: { id: 'u3', full_name: 'Elvin Kərimov', avatar_url: null },
      skill: { id: 12, name: 'Python' },
    },
  ],
}

// Testlər üçün tutulan son yazılar
export const captured = {
  profileUpdate: null as Row | null,
  lastOldPassword: null as string | null,
  lastResetEmail: null as string | null,
}

function tableResult(table: string): MockResult {
  switch (table) {
    case 'profiles':
      return { data: DB.profiles[0], error: null }
    case 'user_skills':
      return { data: DB.user_skills, error: null }
    case 'skills':
      return { data: DB.skills, error: null }
    case 'credit_transactions':
      return { data: DB.credit_transactions, error: null }
    case 'reviews':
      return { data: DB.reviews, error: null }
    case 'lesson_requests':
      return { data: [], error: null }
    default:
      return { data: [], error: null }
  }
}

// Chainable query builder — eq/order/limit/or/in/single kimi bütün metodlar
// özünü qaytarır, await ediləndə hazır nəticəni resolve edir
function makeQuery(table: string, result: MockResult): unknown {
  const api: Record<PropertyKey, unknown> = {
    select: (...args: unknown[]) => {
      const opts = args[1]
      if (
        table === 'lesson_requests' &&
        opts &&
        typeof opts === 'object' &&
        ('head' in (opts as Row) || 'count' in (opts as Row))
      ) {
        // head:true + count:'exact' sorğusu üçün count qaytar
        return makeQuery(table, {
          data: null,
          error: null,
          count: DB.lesson_requests.completedCount,
        } as unknown as MockResult)
      }
      return proxy
    },
    update: (patch: Row) => {
      if (table === 'profiles') captured.profileUpdate = patch
      return proxy
    },
  }

  const proxy = new Proxy(api, {
    get(target, prop: string | symbol) {
      if (prop in target) return target[prop]

      if (prop === 'then') {
        return (
          onFulfilled?: ((value: MockResult) => unknown) | null,
          onRejected?: ((reason: unknown) => unknown) | null
        ) => Promise.resolve(result).then(onFulfilled, onRejected)
      }

      if (prop === 'catch') {
        return (onRejected?: (reason: unknown) => unknown) =>
          Promise.resolve(result).catch(onRejected)
      }

      if (prop === 'finally') {
        return (onFinally?: (() => void) | null) =>
          Promise.resolve(result).finally(onFinally)
      }

      if (prop === Symbol.toStringTag) return 'Promise'

      // eq, order, limit, or, in, single, maybeSingle, range, insert, delete...
      return () => proxy
    },
  })

  return proxy
}

const auth = {
  getSession: async () => ({
    data: { session: { user: mockUser, access_token: 'mock-token' } },
    error: null,
  }),
  onAuthStateChange: () => ({
    data: { subscription: { unsubscribe: () => {} } },
  }),
  signInWithPassword: async (opts: { email: string; password: string }) => {
    captured.lastOldPassword = opts.password
    if (opts.password === 'correctOld123') {
      return { data: { user: mockUser }, error: null }
    }
    return {
      data: { user: null },
      error: {
        code: 'invalid_credentials',
        message: 'Invalid login credentials',
        status: 400,
      },
    }
  },
  updateUser: async () => ({ data: { user: mockUser }, error: null }),
  resetPasswordForEmail: async (email: string) => {
    captured.lastResetEmail = email
    return {
      data: {},
      error: {
        code: 'over_email_send_rate_limit',
        message: 'Email rate limit exceeded',
        status: 429,
      },
    }
  },
  verifyOtp: async () => ({ data: {}, error: null }),
  signOut: async () => ({ error: null }),
}

const supabaseMock = {
  auth,
  from: (table: string) => makeQuery(table, tableResult(table)),
  // Bildiriş sistemi və digər RPC-lər üçün no-op rpc
  rpc: async () => ({ data: null, error: null }),
  // Realtime channel mock — chainable .on().subscribe()
  channel: () => {
    const channel = {
      on: () => channel,
      subscribe: (cb?: (status: string) => void) => {
        void cb?.('SUBSCRIBED')
        return channel
      },
    }
    return channel
  },
  removeChannel: async () => 'ok',
  functions: { invoke: async () => ({ data: null, error: null }) },
  storage: {
    from: () => ({
      upload: async () => ({ data: null, error: null }),
      getPublicUrl: () => ({ data: { publicUrl: '' } }),
    }),
  },
} as unknown as SupabaseClient

export const supabase = supabaseMock
