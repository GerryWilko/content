import { pascalCase } from 'scule'
import { z } from 'zod'
import type { ZodArrayDef, ZodObject, ZodOptionalDef, ZodRawShape, ZodStringDef, ZodType } from 'zod'
import type { Collection, ResolvedCollection, CollectionSource, DefinedCollection } from '../types/collection'
import { metaSchema, pageSchema } from './schema'
import type { ZodFieldType } from './zod'
import { getUnderlyingType, ZodToSqlFieldTypes } from './zod'

const JSON_FIELDS_TYPES = ['ZodObject', 'ZodArray', 'ZodRecord', 'ZodIntersection', 'ZodUnion']

export function defineCollection<T extends ZodRawShape>(collection: Collection<T>): DefinedCollection {
  let schema = collection.schema || z.object({})
  if (collection.type === 'page') {
    schema = pageSchema.extend((schema as ZodObject<ZodRawShape>).shape)
  }

  schema = metaSchema.extend((schema as ZodObject<ZodRawShape>).shape)

  return {
    type: collection.type,
    source: refineSource(collection.source),
    schema,
  }
}

export function resolveCollections(collections: Record<string, DefinedCollection>): ResolvedCollection[] {
  collections._info = defineCollection({
    type: 'data',
    schema: z.object({
      version: z.string(),
    }),
  })

  return Object.entries(collections).map(([name, collection]) => {
    return {
      ...collection,
      name,
      type: collection.type || 'page',
      pascalName: pascalCase(name),
      source: refineSource(collection.source),
      table: generateCollectionTableDefinition(name, collection),
      generatedFields: {
        raw: typeof collection.schema.shape.raw !== 'undefined',
        body: typeof collection.schema.shape.body !== 'undefined',
        path: typeof collection.schema.shape.path !== 'undefined',
      },
      jsonFields: Object.keys(collection.schema.shape || {})
        .filter(key => JSON_FIELDS_TYPES
          .includes(getUnderlyingType(collection.schema.shape[key]).constructor.name)),
    }
  })
}

/**
 * Process collection source and return refined source
 */
function refineSource(source: string | CollectionSource | undefined): CollectionSource | undefined {
  if (typeof source === 'string') {
    return { path: source, prefix: '' }
  }

  if (source) {
    return { ...(source as unknown as CollectionSource) }
  }

  return undefined
}

export function parseSourceBase(source: CollectionSource) {
  const [fixPart, ...rest] = source.path.includes('*') ? source.path.split('*') : ['', source.path]
  return {
    fixed: fixPart,
    dynamic: '*' + rest.join('*'),
  }
}

// Convert collection data to SQL insert statement
export function generateCollectionInsert(collection: ResolvedCollection, data: Record<string, unknown>) {
  const fields: string[] = []
  const values: Array<string | number | boolean> = []

  Object.entries((collection.schema).shape).forEach(([key, value]) => {
    const underlyingType = getUnderlyingType(value as ZodType<unknown, ZodOptionalDef>)

    const defaultValue = value._def.defaultValue ? value._def.defaultValue() : 'NULL'

    fields.push(key)
    if ((collection.jsonFields || []).includes(key)) {
      values.push(data[key] ? `'${JSON.stringify(data[key]).replace(/'/g, '\'\'')}'` : defaultValue)
    }
    else if (['ZodString', 'ZodEnum'].includes(underlyingType.constructor.name)) {
      values.push(data[key] ? `'${String(data[key]).replace(/'/g, '\'\'')}'` : defaultValue)
    }
    else if (['ZodDate'].includes(underlyingType.constructor.name)) {
      values.push(data[key] ? `'${new Date(data[key] as string).toISOString()}'` : defaultValue)
    }
    else if (underlyingType.constructor.name === 'ZodBoolean') {
      values.push(data[key] ? true : false)
    }
    else {
      values.push(data[key] ? data[key] as string | number | boolean : defaultValue)
    }
  })

  let index = 0

  return `INSERT OR REPLACE INTO ${collection.name} (${fields.map(f => `\`${f}\``).join(', ')}) VALUES (${'?,'.repeat(values.length).slice(0, -1)})`
    .replace(/\?/g, () => values[index++] as string)
}

// Convert a collection with Zod schema to SQL table definition
export function generateCollectionTableDefinition(name: string, collection: DefinedCollection) {
  const sqlFields = Object.entries(collection.schema.shape).map(([key, zodType]) => {
    const underlyingType = getUnderlyingType(zodType)

    // Convert nested objects to TEXT
    if (JSON_FIELDS_TYPES.includes(underlyingType.constructor.name)) {
      return `${key} TEXT`
    }

    if (key === 'contentId') return `${key} TEXT PRIMARY KEY`

    let sqlType = ZodToSqlFieldTypes[underlyingType.constructor.name as ZodFieldType]
    if (!sqlType) throw new Error(`Unsupported Zod type: ${underlyingType.constructor.name}`)

    // Handle string length
    if (underlyingType.constructor.name === 'ZodString' && (underlyingType._def as ZodArrayDef).maxLength) {
      sqlType += `(${(underlyingType._def as ZodArrayDef).maxLength?.value})`
    }

    // Handle optional fields
    let constraints = ''
    if (zodType._def.innerType) {
      const _def = zodType._def.innerType._def as ZodStringDef
      if (_def.checks && _def.checks.some(check => check.kind === 'min')) {
        constraints += ' NOT NULL'
      }
      else {
        constraints += ' NULL'
      }
    }
    else {
      const _def = zodType._def as ZodStringDef
      if (_def.checks && _def.checks.some(check => check.kind === 'min')) {
        constraints += ' NOT NULL'
      }
      else {
        constraints += ' NULL'
      }
    }

    // Handle default values
    if (zodType._def.defaultValue !== undefined) {
      constraints += ` DEFAULT ${typeof zodType._def.defaultValue() === 'string' ? `'${zodType._def.defaultValue()}'` : zodType._def.defaultValue()}`
    }

    return `\`${key}\` ${sqlType}${constraints}`
  })
  return `CREATE TABLE IF NOT EXISTS ${name} (${sqlFields.join(',  ')})`
}
