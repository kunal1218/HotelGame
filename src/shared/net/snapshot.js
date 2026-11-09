// @ts-check
import { Visibility, quantize } from './schema.js';
/** Quantize each entity once per tick; recipient filtering still happens per connection. */
export function prepareSnapshot(entities,schemas){
  const rows=[];
  for(const entity of entities){
    const schema=schemas.get(entity.kind);if(!schema)throw new Error(`Unknown kind ${entity.kind}`);
    const publicFields={},ownerFields={};
    for(const [key,spec] of Object.entries(schema.fields)){
      if(spec.vis===Visibility.SERVER)continue;
      const target=spec.vis===Visibility.OWNER?ownerFields:publicFields;
      target[key]=quantize(spec.type,entity.fields[key]);
    }
    rows.push({id:entity.id,kind:entity.kind,owner:entity.owner,publicFields,ownerFields});
  }
  return ({tick,ack,recipient})=>({tick,ack,ents:rows.map(row=>({id:row.id,kind:row.kind,fields:row.owner===recipient?{...row.publicFields,...row.ownerFields}:{...row.publicFields}}))});
}
export function buildSnapshot(entities,schemas,context){return prepareSnapshot(entities,schemas)(context);}
