from abc import ABC, abstractmethod
from dataclasses import dataclass
import logging

import pandas as pd
from pandera.typing import DataFrame

from cde_harvester.schemas import (
    DatasetSchema,
    ObisCellSchema,
    ProfileSchema,
    SkippedDatasetSchema,
    VariableSchema,
)

logger = logging.getLogger(__name__)


@dataclass
class HarvestResult:
    """Standardized output for all harvesters."""

    profiles: DataFrame[ProfileSchema]
    datasets: DataFrame[DatasetSchema]
    variables: DataFrame[VariableSchema]
    skipped: DataFrame[SkippedDatasetSchema]
    obis_cells: DataFrame[ObisCellSchema] = None

    def __post_init__(self):
        if self.obis_cells is None:
            self.obis_cells = pd.DataFrame(columns=ObisCellSchema.to_schema().columns.keys())

    def validate(self):
        """Validate all DataFrames against their schemas."""
        for name, schema in [
            ("profiles", ProfileSchema),
            ("datasets", DatasetSchema),
            ("variables", VariableSchema),
            ("skipped", SkippedDatasetSchema),
            ("obis_cells", ObisCellSchema),
        ]:
            df = getattr(self, name)
            schema.validate(df)


class BaseHarvester(ABC):
    """Abstract base class for CDE harvesters.

    All harvesters must implement the harvest() method which returns
    a HarvestResult containing the harvested DataFrames.
    """

    @abstractmethod
    def harvest(self) -> HarvestResult:
        """Execute the harvest process.

        Returns:
            HarvestResult: The harvested data.
        """
        pass
