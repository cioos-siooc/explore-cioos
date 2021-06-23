#!/bin/sh
set -e

# This assumes your Python evironment is setup.
# If it isn't, you can also run these tests with 'docker build .' from the parent directory

for test_file in test/*.json; do
    echo $test_file
    python3 -m erddap_downloader $test_file
    unzip out/*zip
    ls

    # Verify that a real CSV was created
    python3 -c "import pandas,glob; \
               csv_file=glob.glob('ceda_download*/*.csv')[0]; \
               print('Loading csv_file:',csv_file); \
               df=pandas.read_csv(csv_file); \
               print(df)"

done
