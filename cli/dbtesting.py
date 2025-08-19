import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

from sqlalchemy.exc import SQLAlchemyError


from sqlscripts import sqlscripts

load_dotenv(os.getcwd() + "/.env")
print("loading: " + os.getcwd() + "/.env")
envs = os.environ
database_link = f"postgresql://{envs['DB_USER']}:{envs['DB_PASSWORD']}@{envs['DB_HOST_EXTERNAL']}:{envs.get('DB_PORT', 5432)}/{envs['DB_NAME']}"

print(database_link)
engine = create_engine(database_link)
#print(envs)

#print(sqlscripts.schema)

try:
    engine = create_engine(database_link)
    with engine.begin() as conn:
        conn.execute(text(sqlscripts.schema))
        print("✅ Schema executed successfully.")
except SQLAlchemyError as e:
    print("❌ SQLAlchemy error occurred:", str(e))
except Exception as e:
    print("❌ Unexpected error occurred:", str(e))


"""
with engine.begin() as conn:
    result = conn.execute(text(sqlscripts.schema))
    if result.returns_rows:
        for row in result:
            print(row)

"""