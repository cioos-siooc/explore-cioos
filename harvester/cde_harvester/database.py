import csv
import logging
from io import StringIO

import pandas as pd
from sqlalchemy import create_engine

logger = logging.getLogger(__name__)


class Database:
    def __init__(self, username, password, host, port, name, schema):
        self.username = (username,)
        self.password = (password,)
        self.host = (host,)
        self.port = (port,)
        self.name = (name,)
        self.schema = schema
        self.conn = self.get_connection()
        self.engine = self.get_engine()
        self.transaction = None

    def get_connection(self):
        return f"postgresql://{self.username}:{self.password}@{self.host}:{self.port}/{self.name}"

    def get_engine(self):
        return create_engine(self.conn)

    def add_dataset_and_profiles(
        self, dataset: dict, profiles: pd.DataFrame, on_exist_already: str = "replace"
    ):
        with self.engine.begin() as self.transaction:
            self._update_datasets_table(dataset, on_exist_already)
            self._update_profiles_table(profiles, on_exist_already)

    def _update_profiles_table(
        self, profiles: pd.DataFrame, on_exist_already: str = "replace"
    ):
        self._update_database_table(
            "profiles",
            self.transaction,
            profiles,
            distinct_columns=[
                "erddap_url",
                "dataset_id",
                "profile_id",
                "timeseries_id",
                "trajectory_id",
            ],
            if_row_exist=on_exist_already,
        )

    def _update_datasets_table(
        self, datasets: pd.DataFrame, on_exist_already: str = "replace"
    ):
        self._update_database_table(
            "datasets",
            self.transaction,
            datasets,
            distinct_columns=["erddap_url", "dataset_id"],
            if_row_exist=on_exist_already,
        )

    def delete_dataset_profiles(self, dataset: dict, profiles: pd.DataFrame):
        with self.engine.begin() as self.transaction:
            self.transaction.execute(
                "DELETE FROM datasets WHERE erddap_url = %s AND dataset_id = %s",
            )
            self._delete_datasets_table(dataset)
        pass

    def add_dataset(self, dataset: dict):
        pass

    def delete_dataset(self, dataset: dict):
        with self.engine.begin() as self.transaction:
            self.transaction.execute(
                f"DELETE FROM datasets WHERE erddap_url = '{dataset['erddap_url']}' AND dataset_id = '{dataset['dataset_id']}'",
            )

    def process_records(self):
        self.transaction.execute("SELECT profile_process();")

    def ckan_process(self):
        self.transaction.execute("SELECT ckan_process();")

    def create_hexes(self):
        self.transaction.execute("SELECT create_hexes();")

    def set_constraints(self):
        self.transaction.execute("SELECT set_constraints();")

    def run_db_processes(self):
        with self.engine.begin() as self.transaction:
            self.process_records()
            self.create_hexes()
            self.set_constraints()

    @staticmethod
    def _update_database_table(
        df, table, conn, distinct_columns=None, schema=None, if_row_exist="UPDATE"
    ):
        """
        Method use to update database table, it first upload to
        a temporary table, which then update the original table with any new sample that aren't available already.
        """

        def _psql_insert_copy(table, conn, keys, data_iter):
            """
            Execute SQL statement inserting data into a postgresql db with using COPY from CSV to a temporary table and then update on conflict or nothing

            Parameters
            ----------
            table : pandas.io.sql.SQLTable
            conn : sqlalchemy.engine.Engine or sqlalchemy.engine.Connection
            keys : list of str
                Column names
            data_iter : Iterable that iterates the values to be inserted
            """
            # gets a DBAPI connection that can provide a cursor
            dbapi_conn = conn.connection
            with dbapi_conn.cursor() as cur:
                s_buf = StringIO()
                writer = csv.writer(s_buf)
                writer.writerows(data_iter)
                s_buf.seek(0)

                columns = ", ".join(f'"{k}"' for k in keys)
                table_name = (
                    f"{table.schema}.{table.name}" if table.schema else table.name
                )
                if distinct_columns:
                    on_conflict = f"ON CONFLICT ({','.join(distinct_columns)}) DO "
                    if if_row_exist == "UPDATE":
                        on_conflict += f"UPDATE  SET ({','.join(available_columns)}) = ({','.join([f'EXCLUDED.{item}' for item in available_columns])})"

                    else:
                        on_conflict += "NOTHING"
                else:
                    on_conflict = ""

                sql = f"""
                CREATE TEMP TABLE tmp_table
                (LIKE {table_name} INCLUDING DEFAULTS)
                ON COMMIT DROP;

                COPY tmp_table ({columns}) FROM STDIN WITH CSV;
            
                INSERT INTO {table_name}
                SELECT * FROM tmp_table
                {on_conflict};
                """
                cur.copy_expert(sql=sql, file=s_buf)

        # Sort columns to be same as datbase ignore the extra variables
        table_columns = [
            conn.execute(f"SELECT * FROM {schema+'.' or ''}{table}").keys()
        ]
        available_columns = [
            col for col in table_columns if col in df or col in df.index.names
        ]
        df_update = df.reset_index()[available_columns]

        logging.info("Append data to table %s", table)

        df_update.to_sql(
            table,
            schema=schema,
            if_exists="append",
            con=conn,
            index=False,
            method=_psql_insert_copy,
        )
