"""Validator for the deliberately small keyword subset used by schemas.json."""
import json,pathlib,re
SCHEMAS=json.loads(pathlib.Path(__file__).with_name('schemas.json').read_text())['$defs']
def validate(value,schema):
    if isinstance(schema,str):schema=SCHEMAS[schema]
    kind=schema.get('type')
    if kind:
        kinds=kind if isinstance(kind,list) else [kind]
        actual={dict:'object',list:'array',str:'string',int:'integer',bool:'boolean',type(None):'null'}.get(type(value))
        if actual not in kinds:raise ValueError('SCHEMA_TYPE')
    if 'enum' in schema and value not in schema['enum']:raise ValueError('SCHEMA_ENUM')
    if isinstance(value,dict):
        if set(value)!=set(schema['required']):raise ValueError('SCHEMA_KEYS')
        for k,v in value.items():validate(v,schema['properties'][k])
    elif isinstance(value,list):
        if len(value)>schema['maxItems']:raise ValueError('SCHEMA_SIZE')
        for v in value:validate(v,schema['items'])
    elif isinstance(value,str):
        if not schema.get('minLength',0)<=len(value)<=schema.get('maxLength',float('inf')):raise ValueError('SCHEMA_LENGTH')
        if 'pattern' in schema and not re.search(schema['pattern'],value):raise ValueError('SCHEMA_PATTERN')
    elif type(value) is int:
        if not schema.get('minimum',float('-inf'))<=value<=schema.get('maximum',float('inf')):raise ValueError('SCHEMA_RANGE')
