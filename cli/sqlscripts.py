class sqlscripts:
    folder = "../database/"

    try:
        scriptname = "1_schema.sql"
        with open(folder + scriptname, "r") as scriptfile:
            schema = scriptfile.read()

        scriptname = "3_ckan_process.sql"
        with open(folder + scriptname) as scriptfile:
            ckan_process = scriptfile.read()

        scriptname = "4_create_hexes.sql"
        with open(folder + scriptname) as scriptfile:
            create_hexes = scriptfile.read()

        scriptname = "5_profile_process.sql"
        with open(folder + scriptname) as scriptfile:
            profile_process = scriptfile.read()

        scriptname = "6_remove_all_data.sql"
        with open(folder + scriptname) as scriptfile:
            remove_all_data = scriptfile.read()

        scriptname = "7_contraints.sql"
        with open(folder + scriptname) as scriptfile:
            constraints = scriptfile.read()

        scriptname = "8_range_functions.sql"
        with open(folder + scriptname) as scriptfile:
            range_functions = scriptfile.read()

    except FileNotFoundError:
        print(f"Error: The file {folder + scriptname} was not found.")
    except Exception as e:
        print(f"An error occurred: {e}")
