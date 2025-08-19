class sqlscripts:

    folder = "../database/"
    
    try:
        with open(folder+"1_schema.sql","r") as scriptfile:
            schema = scriptfile.read()
              
        with open(folder+"3_ckan_process.sql") as scriptfile:
            ckan_process = scriptfile.read()

        with open(folder+"4_create_hexes.sql") as scriptfile:
            create_hexes = scriptfile.read()
        
        with open(folder+"5_profile_process.sql") as scriptfile:
            profile_process = scriptfile.read()

        with open(folder+"6_remove_all_data.sql") as scriptfile:
            remove_all_data = scriptfile.read()
        
        with open(folder+"7_contraints.sql") as scriptfile:
            constraints = scriptfile.read()
        
        with open(folder+"8_range_functions.sql") as scriptfile:
            range_functions = scriptfile.read()      


    except FileNotFoundError:
        print("Error: The file 'your_file.txt' was not found.")
    except Exception as e:
        print(f"An error occurred: {e}")
    