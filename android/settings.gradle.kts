pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven {
            url = uri("https://repos.vivo.com.cn/maven/repository/external-lib/")
            content { includeGroup("vivo") }
        }
    }
}

rootProject.name = "hapi-android"

include(":app")
include(":core:protocol")
include(":core:data")
