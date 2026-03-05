from abc import ABC, abstractmethod
from dataclasses import dataclass

import pandas as pd


@dataclass
class HarvestResult:
    """Standardized output for all harvesters."""

    profiles: pd.DataFrame
    datasets: pd.DataFrame
    variables: pd.DataFrame
    skipped: pd.DataFrame


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
