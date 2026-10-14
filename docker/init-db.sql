\getenv gym_db_user GYM_DB_USER
\getenv gym_db_password GYM_DB_PASSWORD
\getenv gym_db_name POSTGRES_DB

CREATE ROLE :"gym_db_user"
  WITH LOGIN PASSWORD :'gym_db_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CONNECT ON DATABASE :"gym_db_name" TO :"gym_db_user";
CREATE SCHEMA gym AUTHORIZATION :"gym_db_user";
